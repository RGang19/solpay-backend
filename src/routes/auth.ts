import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { createCustodialWallet } from '../services/walletService.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

// In-memory store for mocked OTPs (phone -> otp)
const otpStore = new Map<string, string>();

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
    const token = jwt.sign({ userId: user.id, phone: user.phone }, JWT_SECRET, {
      expiresIn: '7d'
    });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        wallet_address: user.wallet_address
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

export default router;
