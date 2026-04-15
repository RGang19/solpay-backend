import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import prisma from '../config/db.js';
import { createCustodialWallet } from '../services/walletService.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';
import { issueSession } from '../services/sessionService.js';

const router = Router();
// In-memory store for mocked OTPs (phone -> otp)
const otpStore = new Map<string, string>();

const userResponse = (
  user: {
  id: string;
  name: string | null;
  phone: string;
  wallet_address: string;
  encrypted_private_key?: string;
  is_merchant?: boolean;
  },
  linkedWallets: Array<{ wallet_address: string; label: string | null; source: string }> = [],
) => {
  const primaryLabel = user.encrypted_private_key
    ? 'Mobile-created custodial wallet'
    : 'Signed Solana wallet';

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    wallet_address: user.wallet_address,
    is_merchant: user.is_merchant || false,
    wallets: [
      {
        address: user.wallet_address,
        type: user.encrypted_private_key ? 'mobile_created' : 'primary',
        label: primaryLabel,
        isPrimary: true,
      },
      ...linkedWallets.map((wallet) => ({
        address: wallet.wallet_address,
        type: 'attached',
        label: wallet.label || 'Attached Solana wallet',
        source: wallet.source,
        isPrimary: false,
      })),
    ],
  };
};

const userWithWallets = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { linked_wallets: true },
  });
  return user;
};

const decodeSignature = (signature: unknown) => {
  if (Array.isArray(signature)) {
    return Uint8Array.from(signature);
  }

  if (typeof signature !== 'string') {
    throw new Error('Signature must be a byte array, base58 string, or base64 string');
  }

  try {
    return bs58.decode(signature);
  } catch {
    return Uint8Array.from(Buffer.from(signature, 'base64'));
  }
};

router.post('/wallet/challenge', async (req: Request, res: Response) => {
  const { walletAddress } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  try {
    const wallet = new PublicKey(walletAddress).toBase58();
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const message = [
      'Sign in to Solana App Infrastructure SDK',
      `Wallet: ${wallet}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
      'This signature proves wallet ownership and does not authorize a transaction.',
    ].join('\n');

    await prisma.authChallenge.create({
      data: {
        wallet_address: wallet,
        nonce,
        message,
        expires_at: expiresAt,
      },
    });

    res.status(200).json({ walletAddress: wallet, nonce, message, expiresAt });
  } catch {
    res.status(400).json({ error: 'Invalid Solana wallet address' });
  }
});

router.post('/wallet/verify', async (req: Request, res: Response) => {
  const { walletAddress, signature, nonce } = req.body;

  if (!walletAddress || !signature || !nonce) {
    return res.status(400).json({ error: 'walletAddress, signature, and nonce are required' });
  }

  try {
    const wallet = new PublicKey(walletAddress).toBase58();
    const challenge = await prisma.authChallenge.findUnique({ where: { nonce } });

    if (!challenge || challenge.wallet_address !== wallet || challenge.used_at) {
      return res.status(401).json({ error: 'Invalid or already used wallet challenge' });
    }

    if (challenge.expires_at.getTime() < Date.now()) {
      return res.status(401).json({ error: 'Wallet challenge expired' });
    }

    const verified = ed25519.verify(
      decodeSignature(signature),
      new TextEncoder().encode(challenge.message),
      new PublicKey(wallet).toBytes(),
    );

    if (!verified) {
      return res.status(401).json({ error: 'Invalid wallet signature' });
    }

    let user = await prisma.user.findUnique({
      where: { wallet_address: wallet },
      include: { linked_wallets: true },
    });
    if (!user) {
      const linkedWallet = await prisma.linkedWallet.findUnique({
        where: { wallet_address: wallet },
        include: { user: { include: { linked_wallets: true } } },
      });
      user = linkedWallet?.user || null;
    }
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: `wallet:${wallet}`,
          wallet_address: wallet,
          encrypted_private_key: '',
          name: null,
        },
        include: { linked_wallets: true },
      });
    }

    await prisma.authChallenge.update({
      where: { nonce },
      data: { used_at: new Date(), user_id: user.id },
    });

    const { token, expiresAt } = await issueSession(user);

    res.status(200).json({
      message: 'Wallet login successful',
      token,
      expiresAt,
      user: userResponse(user, user.linked_wallets),
    });
  } catch (error) {
    console.error('Wallet login error:', error);
    res.status(500).json({ error: 'Could not verify wallet login' });
  }
});

router.get('/session/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await userWithWallets(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.status(200).json({ user: userResponse(user, user.linked_wallets) });
});

router.post('/phone/attach', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { phone, otp } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

  const storedOtp = otpStore.get(phone);
  if (storedOtp !== otp) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { linked_wallets: true },
    });
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    const existingPhoneUser = await prisma.user.findUnique({
      where: { phone },
      include: { linked_wallets: true },
    });
    if (existingPhoneUser && existingPhoneUser.id !== currentUser.id) {
      const alreadyLinked = existingPhoneUser.linked_wallets.some(
        (wallet) => wallet.wallet_address === currentUser.wallet_address,
      );

      if (!alreadyLinked && existingPhoneUser.wallet_address !== currentUser.wallet_address) {
        const linkedElsewhere = await prisma.linkedWallet.findUnique({
          where: { wallet_address: currentUser.wallet_address },
        });
        if (linkedElsewhere && linkedElsewhere.user_id !== existingPhoneUser.id) {
          return res.status(409).json({ error: 'Wallet is already attached to another phone account' });
        }

        await prisma.linkedWallet.create({
          data: {
            user_id: existingPhoneUser.id,
            wallet_address: currentUser.wallet_address,
            label: 'Attached Solana wallet',
          },
        });
      }

      otpStore.delete(phone);
      const refreshedUser = await userWithWallets(existingPhoneUser.id);
      if (!refreshedUser) return res.status(404).json({ error: 'User not found' });
      const { token, expiresAt } = await issueSession(refreshedUser);

      return res.status(200).json({
        message: 'Phone already had a wallet, so this Solana wallet was attached under the same phone account',
        token,
        expiresAt,
        user: userResponse(refreshedUser, refreshedUser.linked_wallets),
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { phone },
      include: { linked_wallets: true },
    });

    otpStore.delete(phone);

    res.status(200).json({
      message: 'Phone number attached successfully',
      user: userResponse(user, user.linked_wallets),
    });
  } catch (error) {
    console.error('Attach phone error:', error);
    res.status(500).json({ error: 'Could not attach phone number' });
  }
});

/**
 * POST /api/auth/send-otp
 * Mocks sending an OTP to the user's phone.
 */
router.post('/send-otp', async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Generate a mock 6-digit OTP
  const mockOtp = '123456'; // Fixed for MVP testing. In production: Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(phone, mockOtp);

  // Log to console for development
  console.log(`[MOCK SMS] Sent OTP ${mockOtp} to ${phone}`);

  res.status(200).json({ message: 'OTP sent successfully (check console)' });
});

/**
 * POST /api/auth/verify-otp
 * Verifies OTP, creates user & wallet if new, and returns JWT.
 */
router.post('/verify-otp', async (req: Request, res: Response) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  const storedOtp = otpStore.get(phone);
  if (storedOtp !== otp) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  try {
    // Clear OTP after successful use
    otpStore.delete(phone);

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { phone },
      include: { linked_wallets: true },
    });

    // If new user, create their profile and custodial wallet
    if (!user) {
      console.log(`Creating new custodial wallet for ${phone}...`);
      const { publicKey, encryptedPrivateKey } = createCustodialWallet();

      user = await prisma.user.create({
        data: {
          name: null,
          phone,
          wallet_address: publicKey,
          encrypted_private_key: encryptedPrivateKey
        },
        include: { linked_wallets: true },
      });
    }

    const { token, expiresAt } = await issueSession(user);

    res.status(200).json({
      message: 'Login successful',
      token,
      expiresAt,
      user: userResponse(user, user.linked_wallets)
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

export default router;
