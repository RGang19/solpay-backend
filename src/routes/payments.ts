import { Router } from 'express';
import type { Response } from 'express';
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';
import { getDecryptedKeypair } from '../services/walletService.js';

const router = Router();
const solanaConnection = new Connection('https://api.devnet.solana.com', 'confirmed');

/**
 * POST /api/payments/send
 * Sends SOL to another user's phone number
 */
router.post('/send', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { phone, amount, token = 'SOL' } = req.body; // amount in SOL or USDC
  const senderId = req.user?.userId;

  if (!phone || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid phone and amount are required' });
  }

  if (!senderId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // 1. Look up sender
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    // Prevent sending to self
    if (sender.phone === phone) {
      return res.status(400).json({ error: 'Cannot send money to yourself' });
    }

    // 2. Determine Receiver PublicKey
    let receiverPublicKey: PublicKey;
    let receiverId: string | null = null;
    let receiverWalletAddress: string;

    if (phone.length > 30 && !phone.startsWith('+')) {
      // Treat as direct Solana address
      try {
        receiverPublicKey = new PublicKey(phone);
        receiverWalletAddress = phone;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid Solana address format' });
      }
    } else {
      // Look up receiver by phone
      const receiver = await prisma.user.findUnique({ where: { phone } });
      if (!receiver) {
        return res.status(404).json({ error: 'Receiver not found (user must sign up first)' });
      }
      receiverPublicKey = new PublicKey(receiver.wallet_address);
      receiverId = receiver.id;
      receiverWalletAddress = receiver.wallet_address;
    }

    // 3. Prepare Solana Transaction
    const senderKeypair = getDecryptedKeypair(sender.encrypted_private_key);
    const transaction = new Transaction();

    if (token === 'USDC') {
      const usdcAmount = Math.floor(amount * 1e6); // USDC has 6 decimals
      const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
      
      try {
        const senderATA = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          senderKeypair,
          USDC_MINT,
          senderKeypair.publicKey
        );
        const receiverATA = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          senderKeypair, // Sender pays to create ATA if needed
          USDC_MINT,
          receiverPublicKey
        );

        transaction.add(
          createTransferInstruction(
            senderATA.address,
            receiverATA.address,
            senderKeypair.publicKey,
            usdcAmount
          )
        );
      } catch (err: any) {
        return res.status(500).json({ error: 'Failed to initialize USDC accounts: ' + err.message });
      }
    } else {
      const lamports = Math.floor(amount * 1e9); // Convert SOL to lamports
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey: receiverPublicKey,
          lamports,
        })
      );
    }

    // 4. Send and Confirm Transaction
    console.log(`Sending ${amount} ${token} from ${sender.wallet_address} to ${receiverWalletAddress}...`);
    
    // This will throw if the sender doesn't have enough balance or if network fails
    const signature = await sendAndConfirmTransaction(solanaConnection, transaction, [senderKeypair]);
    
    console.log('Transaction signature:', signature);

    // 5. Save to Database
    const newTransaction = await prisma.transaction.create({
      data: {
        amount,
        tx_hash: signature,
        status: 'SUCCESS',
        token,
        sender_id: sender.id,
        ...(receiverId && { receiver_id: receiverId })
      }
    });

    res.status(200).json({
      message: 'Payment sent successfully',
      transaction: newTransaction
    });

  } catch (error: any) {
    console.error('Payment Error:', error.message || error);
    
    // Attempt to log failed transaction if possible (without tx_hash)
    // For MVPs we just return the error
    return res.status(500).json({ error: 'Failed to process payment. Ensure you have enough Devnet SOL.' });
  }
});

export default router;
