import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Configuration for encryption
// WARNING: In production, this should be a secure key retrieved from environment variables
// For MVP, using a fallback 32-byte key if not provided (though JWT_SECRET is currently used loosely as AES key)
// It's better to have a dedicated ENCRYPTION_KEY in .env

const getEncryptionKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 bytes for AES-256
  // Ensure exactly 32 bytes
  return crypto.createHash('sha256').update(String(secret)).digest();
};

const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypts a private key using AES-256-CBC
 */
export const encryptPrivateKey = (privateKey: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return IV concatenated with the encrypted text for decryption
  return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts an encrypted private key string back to base58 or original format
 */
export const decryptPrivateKey = (encryptedText: string): string => {
  const textParts = encryptedText.split(':');
  const ivStr = textParts.shift();
  if (!ivStr) throw new Error("Invalid encrypted text format");
  
  const iv = Buffer.from(ivStr, 'hex');
  const encrypted = textParts.join(':');
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

/**
 * Generates a new Solana wallet (Keypair) and returns its public address 
 * and AES-encrypted private key (base58 format).
 */
export const createCustodialWallet = () => {
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const privateKeyBase58 = bs58.encode(keypair.secretKey);
  
  const encryptedPrivateKey = encryptPrivateKey(privateKeyBase58);

  return {
    publicKey,
    encryptedPrivateKey
  };
};

/**
 * Recovers a Keypair object from an encrypted private key string.
 */
export const getDecryptedKeypair = (encryptedPrivateKey: string): Keypair => {
  const privateKeyBase58 = decryptPrivateKey(encryptedPrivateKey);
  const secretKey = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secretKey);
};
