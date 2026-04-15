import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const issueSession = async (user: { id: string; phone?: string | null; wallet_address: string }) => {
  const token = jwt.sign(
    {
      userId: user.id,
      phone: user.phone || undefined,
      walletAddress: user.wallet_address,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      token_hash: hashToken(token),
      user_id: user.id,
      expires_at: expiresAt,
    },
  });

  return { token, expiresAt };
};
