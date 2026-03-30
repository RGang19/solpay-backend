import { Router } from 'express';
import type { Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';

const router = Router();
const solanaConnection = new Connection('https://api.devnet.solana.com', 'confirmed');

/**
 * GET /api/user/me
 * Returns user profile and current SOL balance on Devnet
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        wallet_address: true,
        is_merchant: true,
        created_at: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch balance from Solana Devnet
    const publicKey = new PublicKey(user.wallet_address);
    const balanceLamports = await solanaConnection.getBalance(publicKey);
    const balanceSOL = balanceLamports / 1e9;

    const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    let usdcBalance = 0;
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const account = await getAccount(solanaConnection, ata);
      usdcBalance = Number(account.amount) / 1e6;
    } catch (e) {
      usdcBalance = 0;
    }

    res.status(200).json({
      ...user,
      balance: balanceSOL,
      usdcBalance
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * PUT /api/user/me
 * Updates editable profile fields for the logged-in user
 */
router.put('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const isMerchant = typeof req.body?.is_merchant === 'boolean' ? req.body.is_merchant : undefined;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { 
        ...(req.body.name !== undefined && { 
          name: typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 50) || null : null 
        }),
        ...(isMerchant !== undefined && { is_merchant: isMerchant })
      },
      select: {
        id: true,
        name: true,
        phone: true,
        wallet_address: true,
        is_merchant: true,
        created_at: true
      }
    });

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

export default router;
