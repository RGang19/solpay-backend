import { Router } from 'express';
import type { Response, Request } from 'express';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';

const router = Router();

/**
 * POST /api/requests
 * Create a new payment request (Merchant only)
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.is_merchant) {
      return res.status(403).json({ error: 'Only merchants can create payment requests' });
    }

    const { amount, token = 'SOL', label, message } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        merchant_id: userId,
        amount: Number(amount),
        token,
        label,
        message,
        status: 'PENDING'
      }
    });

    res.status(201).json(paymentRequest);
  } catch (error) {
    console.error('Create payment request error:', error);
    res.status(500).json({ error: 'Failed to create payment request' });
  }
});

/**
 * GET /api/requests/merchant
 * Fetch all payment requests for the logged-in merchant
 */
router.get('/merchant', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const requests = await prisma.paymentRequest.findMany({
      where: { merchant_id: userId },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json(requests);
  } catch (error) {
    console.error('Fetch merchant requests error:', error);
    res.status(500).json({ error: 'Failed to fetch payment requests' });
  }
});

/**
 * GET /api/requests/:id
 * Public endpoint to fetch payment request details for checkout
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid payment request ID' });
    }

    const request = await prisma.paymentRequest.findUnique({
      where: { id },
      include: {
        merchant: {
          select: {
            name: true,
            phone: true,
            wallet_address: true
          }
        }
      }
    });

    if (!request) {
      return res.status(404).json({ error: 'Payment request not found' });
    }

    res.status(200).json(request);
  } catch (error) {
    console.error('Fetch payment request error:', error);
    res.status(500).json({ error: 'Failed to fetch payment request' });
  }
});

/**
 * PUT /api/requests/:id/status
 * Update payment request status (e.g., mark as PAID)
 * In a real app, this would be verified via on-chain polling or webhooks.
 */
router.put('/:id/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid payment request ID' });
    }

    const { status, tx_hash } = req.body;

    if (!['PAID', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    const updatedRequest = await prisma.paymentRequest.update({
      where: { id },
      data: { status }
    });

    res.status(200).json(updatedRequest);
  } catch (error) {
    console.error('Update payment request status error:', error);
    res.status(500).json({ error: 'Failed to update payment request status' });
  }
});

export default router;
