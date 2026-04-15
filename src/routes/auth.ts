import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
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
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

// In-memory store for mocked OTPs (phone -> otp)
const otpStore = new Map<string, string>();

const userResponse = (user: {
  id: string;
  name: string | null;
  phone: string;
  wallet_address: string;
  is_merchant?: boolean;
}) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  wallet_address: user.wallet_address,
  is_merchant: user.is_merchant || false,
});

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

    let user = await prisma.user.findUnique({ where: { wallet_address: wallet } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: `wallet:${wallet}`,
          wallet_address: wallet,
          encrypted_private_key: '',
          name: null,
        },
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
      user: userResponse(user),
    });
  } catch (error) {
    console.error('Wallet login error:', error);
    res.status(500).json({ error: 'Could not verify wallet login' });
  }
});

router.get('/session/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.status(200).json({ user: userResponse(user) });
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
      where: { phone }
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
        }
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, walletAddress: user.wallet_address },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: userResponse(user)
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

export default router;
