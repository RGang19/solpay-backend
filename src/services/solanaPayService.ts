import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const clusterUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(clusterUrl, 'confirmed');

export const getSolanaConnection = () => connection;

export const buildSolanaPayUrl = (params: {
  recipient: string;
  amount: number;
  reference: string;
  label?: string | null;
  message?: string | null;
  memo?: string | null;
}) => {
  const url = new URL(`solana:${params.recipient}`);
  url.searchParams.set('amount', String(params.amount));
  url.searchParams.set('reference', params.reference);
  if (params.label) url.searchParams.set('label', params.label);
  if (params.message) url.searchParams.set('message', params.message);
  if (params.memo) url.searchParams.set('memo', params.memo);
  return url.toString();
};

export const verifySolPayment = async (params: {
  recipient: string;
  reference: string;
  expectedAmount: number;
}) => {
  const reference = new PublicKey(params.reference);
  const recipient = new PublicKey(params.recipient);
  const signatures = await connection.getSignaturesForAddress(reference, { limit: 20 });

  for (const item of signatures) {
    const tx = await connection.getParsedTransaction(item.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta || tx.meta.err) continue;

    const accountIndex = tx.transaction.message.accountKeys.findIndex((account) =>
      account.pubkey.equals(recipient),
    );
    if (accountIndex < 0) continue;

    const delta =
      (tx.meta.postBalances[accountIndex] || 0) - (tx.meta.preBalances[accountIndex] || 0);
    const receivedSol = delta / LAMPORTS_PER_SOL;

    if (receivedSol + Number.EPSILON >= params.expectedAmount) {
      return { signature: item.signature, receivedSol };
    }
  }

  return null;
};
