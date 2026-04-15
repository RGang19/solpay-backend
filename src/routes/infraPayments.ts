import crypto from 'crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { Keypair, PublicKey } from '@solana/web3.js';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';
import { createNotification } from '../services/notificationService.js';
import { buildSolanaPayUrl, verifySolPayment } from '../services/solanaPayService.js';

const router = Router();

const getConfiguredRecipient = (fallbackWallet?: string) => {
  const recipient = process.env.MERCHANT_WALLET_ADDRESS || fallbackWallet;
  if (!recipient) throw new Error('MERCHANT_WALLET_ADDRESS is not configured');
  return new PublicKey(recipient).toBase58();
};

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { amount, token = 'SOL', recipientAddress, label, message, memo } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'A positive amount is required' });
  }

  if (token !== 'SOL') {
    return res.status(400).json({ error: 'MVP payment verification supports SOL payments' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const recipient = getConfiguredRecipient(recipientAddress || user.wallet_address);
    const reference = Keypair.generate().publicKey.toBase58();
    const checkoutUrl = buildSolanaPayUrl({
      recipient,
      amount: Number(amount),
      reference,
      label: label || 'Solana App Infrastructure SDK',
      message: message || 'SDK payment request',
      memo: memo || crypto.randomBytes(8).toString('hex'),
    });

    const payment = await prisma.infraPayment.create({
      data: {
        user_id: userId,
        amount: Number(amount),
        token,
        recipient_address: recipient,
        reference,
        label,
        message,
        memo,
        checkout_url: checkoutUrl,
      },
    });

    res.status(201).json({ payment });
  } catch (error) {
    console.error('Create infra payment error:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create payment' });
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const payment = await prisma.infraPayment.findFirst({
    where: { id: req.params.id, user_id: userId },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  res.status(200).json({ payment });
});

router.post('/:id/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const payment = await prisma.infraPayment.findFirst({
    where: { id: req.params.id, user_id: userId },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (payment.status === 'CONFIRMED') {
    return res.status(200).json({ payment });
  }

  try {
    const verified = await verifySolPayment({
      recipient: payment.recipient_address,
      reference: payment.reference,
      expectedAmount: payment.amount,
    });

    if (!verified) {
      return res.status(202).json({ payment, verified: false });
    }

    const updated = await prisma.infraPayment.update({
      where: { id: payment.id },
      data: {
        status: 'CONFIRMED',
        signature: verified.signature,
        confirmed_at: new Date(),
      },
    });

    await createNotification({
      userId,
      type: 'payment.confirmed',
      title: 'Payment confirmed',
      body: `${payment.amount} ${payment.token} payment was confirmed on Solana.`,
      data: { paymentId: payment.id, signature: verified.signature },
    });

    res.status(200).json({ payment: updated, verified: true });
  } catch (error) {
    console.error('Verify infra payment error:', error);
    res.status(500).json({ error: 'Could not verify payment on Solana' });
  }
});

export default router;
