import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import prisma from '../config/db.js';
import { createCustodialWallet } from '../services/walletService.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';
import { issueSession } from '../services/sessionService.js';

const router = Router();
const solanaConnection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
// In-memory store for mocked OTPs (phone -> otp)
const otpStore = new Map<string, string>();

const getWalletBalance = async (address: string) => {
  try {
    const lamports = await solanaConnection.getBalance(new PublicKey(address));
    return lamports / 1e9;
  } catch {
    return 0;
  }
};

const userResponse = async (
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
  const walletItems = await Promise.all([
    getWalletBalance(user.wallet_address).then((balance) => ({
      address: user.wallet_address,
      type: user.encrypted_private_key ? 'mobile_created' : 'primary',
      label: primaryLabel,
      balance,
      token: 'SOL',
      canSend: Boolean(user.encrypted_private_key),
      canReceive: true,
      isPrimary: true,
    })),
    ...linkedWallets.map((wallet) =>
      getWalletBalance(wallet.wallet_address).then((balance) => ({
        address: wallet.wallet_address,
        type: 'attached',
        label: wallet.label || 'Attached Solana wallet',
        source: wallet.source,
        balance,
        token: 'SOL',
        canSend: false,
        canReceive: true,
        isPrimary: false,
      })),
    ),
  ]);

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    wallet_address: user.wallet_address,
    is_merchant: user.is_merchant || false,
    wallets: walletItems,
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
      user: await userResponse(user, user.linked_wallets),
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

  res.status(200).json({ user: await userResponse(user, user.linked_wallets) });
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
        user: await userResponse(refreshedUser, refreshedUser.linked_wallets),
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
      user: await userResponse(user, user.linked_wallets),
    });
  } catch (error) {
    console.error('Attach phone error:', error);
    res.status(500).json({ error: 'Could not attach phone number' });
  }
});

router.post('/wallet/detach', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { walletAddress } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

  try {
    const wallet = new PublicKey(walletAddress).toBase58();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { linked_wallets: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.wallet_address === wallet) {
      return res.status(400).json({
        error: 'Primary mobile-created wallet cannot be detached from its phone account',
      });
    }

    const linkedWallet = await prisma.linkedWallet.findUnique({
      where: { wallet_address: wallet },
    });

    if (!linkedWallet || linkedWallet.user_id !== user.id) {
      return res.status(404).json({ error: 'Attached wallet not found for this account' });
    }

    await prisma.linkedWallet.delete({ where: { wallet_address: wallet } });
    const refreshedUser = await userWithWallets(user.id);
    if (!refreshedUser) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({
      message: 'Attached wallet detached successfully',
      user: await userResponse(refreshedUser, refreshedUser.linked_wallets),
    });
  } catch (error) {
    console.error('Detach wallet error:', error);
    res.status(400).json({ error: 'Could not detach wallet' });
  }
});

const MAX_WALLETS = 10;

router.post('/wallet/attach', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { walletAddress, signature, nonce, label } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!walletAddress || !signature || !nonce) {
    return res.status(400).json({ error: 'walletAddress, signature, and nonce are required' });
  }

  try {
    const wallet = new PublicKey(walletAddress).toBase58();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { linked_wallets: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Enforce max wallets (primary + attached)
    const totalWallets = 1 + user.linked_wallets.length;
    if (totalWallets >= MAX_WALLETS) {
      return res.status(400).json({ error: `Maximum ${MAX_WALLETS} wallets allowed per account` });
    }

    // Check duplicate: not the primary wallet and not already attached
    if (user.wallet_address === wallet) {
      return res.status(409).json({ error: 'This is already your primary wallet' });
    }
    const alreadyLinked = user.linked_wallets.some((w) => w.wallet_address === wallet);
    if (alreadyLinked) {
      return res.status(409).json({ error: 'This wallet is already attached to your account' });
    }

    // Check if this wallet belongs to another user (primary or linked)
    const otherUser = await prisma.user.findUnique({ where: { wallet_address: wallet } });
    if (otherUser && otherUser.id !== user.id) {
      if (otherUser.phone === `wallet:${wallet}`) {
        // It's a stale shell user from a previous wallet login. Safe to delete.
        await prisma.user.delete({ where: { id: otherUser.id } });
      } else {
        return res.status(409).json({ error: 'This wallet is the primary wallet of another account' });
      }
    }
    const otherLinked = await prisma.linkedWallet.findUnique({ where: { wallet_address: wallet } });
    if (otherLinked && otherLinked.user_id !== user.id) {
      return res.status(409).json({ error: 'This wallet is already attached to another account' });
    }

    // Verify challenge
    const challenge = await prisma.authChallenge.findUnique({ where: { nonce } });
    if (!challenge || challenge.wallet_address !== wallet || challenge.used_at) {
      return res.status(401).json({ error: 'Invalid or already used wallet challenge' });
    }
    if (challenge.expires_at.getTime() < Date.now()) {
      return res.status(401).json({ error: 'Wallet challenge expired' });
    }

    // Verify signature
    const verified = ed25519.verify(
      decodeSignature(signature),
      new TextEncoder().encode(challenge.message),
      new PublicKey(wallet).toBytes(),
    );
    if (!verified) {
      return res.status(401).json({ error: 'Invalid wallet signature' });
    }

    // Mark challenge as used
    await prisma.authChallenge.update({
      where: { nonce },
      data: { used_at: new Date(), user_id: user.id },
    });

    // Create linked wallet
    await prisma.linkedWallet.create({
      data: {
        user_id: user.id,
        wallet_address: wallet,
        label: label || 'Attached Solana wallet',
        source: 'WALLET_SIGNATURE',
      },
    });

    const refreshedUser = await userWithWallets(user.id);
    if (!refreshedUser) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({
      message: 'Wallet attached successfully via signature verification',
      user: await userResponse(refreshedUser, refreshedUser.linked_wallets),
    });
  } catch (error) {
    console.error('Attach wallet error:', error);
    res.status(500).json({ error: 'Could not attach wallet' });
  }
});

/**
 * POST /api/auth/wallet/set-primary
 * Allows user to set any of their attached wallets as the primary wallet.
 * The old primary becomes a linked wallet, and the new one becomes primary.
 */
router.post('/wallet/set-primary', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { walletAddress } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

  try {
    const wallet = new PublicKey(walletAddress).toBase58();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { linked_wallets: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Already the primary wallet
    if (user.wallet_address === wallet) {
      return res.status(200).json({
        message: 'This wallet is already the primary wallet',
        user: await userResponse(user, user.linked_wallets),
      });
    }

    // Check the wallet is a linked wallet owned by this user
    const linkedWallet = user.linked_wallets.find((w) => w.wallet_address === wallet);
    if (!linkedWallet) {
      return res.status(404).json({ error: 'Wallet not found in your account. Attach it first.' });
    }

    // Swap: move current primary to linked, move linked to primary
    // 1. Delete the linked wallet entry for the new primary
    await prisma.linkedWallet.delete({ where: { wallet_address: wallet } });

    // 2. Create a linked wallet entry for the old primary
    await prisma.linkedWallet.create({
      data: {
        user_id: user.id,
        wallet_address: user.wallet_address,
        label: user.encrypted_private_key ? 'Mobile-created custodial wallet' : 'Previous primary wallet',
        source: 'PRIMARY_SWAP',
      },
    });

    // Handle collision if a sterile shell user exists with the target wallet_address
    const conflictingUser = await prisma.user.findUnique({ where: { wallet_address: wallet } });
    if (conflictingUser && conflictingUser.id !== user.id) {
      if (conflictingUser.phone === `wallet:${wallet}`) {
        await prisma.user.delete({ where: { id: conflictingUser.id } });
      } else {
        return res.status(409).json({ error: 'This wallet is the primary wallet of another full account.' });
      }
    }

    // 3. Update user's primary wallet address (clear encrypted key since attached wallets are non-custodial)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        wallet_address: wallet,
        encrypted_private_key: '',
      },
    });

    const refreshedUser = await userWithWallets(user.id);
    if (!refreshedUser) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({
      message: 'Primary wallet updated successfully',
      user: await userResponse(refreshedUser, refreshedUser.linked_wallets),
    });
  } catch (error) {
    console.error('Set primary wallet error:', error);
    res.status(500).json({ error: 'Could not update primary wallet' });
  }
});

/**
 * POST /api/auth/send-otp
 * Sends a random 6-digit OTP to the user's phone.
 */
router.post('/send-otp', async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Generate a random 6-digit OTP
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(phone, generatedOtp);

  // Log to console for development
  console.log(`[OTP] Sent OTP ${generatedOtp} to ${phone}`);

  res.status(200).json({ message: 'OTP sent successfully', otp: generatedOtp });
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
      user: await userResponse(user, user.linked_wallets)
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

export default router;
