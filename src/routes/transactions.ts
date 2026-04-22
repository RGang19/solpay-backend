import { Router } from 'express';
import type { Response } from 'express';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';

const router = Router();
const solanaConnection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

/**
 * GET /api/transactions
 * Fetches transaction history for the logged-in user (DB only)
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { sender_id: userId },
          { receiver_id: userId }
        ]
      },
      include: {
        sender: {
          select: { phone: true, wallet_address: true }
        },
        receiver: {
          select: { phone: true, wallet_address: true }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    res.status(200).json(transactions);

  } catch (error) {
    console.error('Fetch transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

/**
 * GET /api/transactions/all
 * Hybrid: merges DB transactions with on-chain Solana transactions
 */
router.get('/all', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Fetch DB transactions
    const dbTransactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { sender_id: userId },
          { receiver_id: userId }
        ]
      },
      include: {
        sender: { select: { phone: true, wallet_address: true } },
        receiver: { select: { phone: true, wallet_address: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    const dbTxHashes = new Set(dbTransactions.map(tx => tx.tx_hash));

    // 2. Fetch on-chain transactions
    const publicKey = new PublicKey(user.wallet_address);
    let onChainTxs: any[] = [];

    try {
      const signatures = await solanaConnection.getSignaturesForAddress(publicKey, { limit: 20 });

      const newSignatures = signatures.filter(sig => !dbTxHashes.has(sig.signature));

      for (const sig of newSignatures) {
        try {
          const parsed = await solanaConnection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0
          });

          if (!parsed?.meta || !parsed.transaction) continue;

          const instructions = parsed.transaction.message.instructions;
          for (const ix of instructions) {
            if ('parsed' in ix && ix.program === 'system' && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info;
              const amount = info.lamports / LAMPORTS_PER_SOL;
              const isSender = info.source === user.wallet_address;

              onChainTxs.push({
                id: `onchain_${sig.signature.slice(0, 12)}`,
                amount,
                tx_hash: sig.signature,
                status: parsed.meta.err ? 'FAILED' : 'SUCCESS',
                token: 'SOL',
                created_at: sig.blockTime
                  ? new Date(sig.blockTime * 1000).toISOString()
                  : new Date().toISOString(),
                sender_id: isSender ? userId : null,
                receiver_id: isSender ? null : userId,
                sender: { phone: isSender ? user.phone : info.source },
                receiver: { phone: isSender ? info.destination : user.phone },
                source: 'onchain'
              });
            }
          }
        } catch (e) {
          // Skip unparseable transactions
        }
      }
    } catch (e) {
      console.error('Failed to fetch on-chain transactions:', e);
    }

    // 3. Merge and sort by date
    const dbFormatted = dbTransactions.map(tx => ({ ...tx, source: 'database' }));
    const merged = [...dbFormatted, ...onChainTxs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.status(200).json(merged);

  } catch (error) {
    console.error('Hybrid fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

export default router;
