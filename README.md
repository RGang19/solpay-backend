# Solana App Infrastructure SDK Backend

Express + TypeScript backend for the Solana App Infrastructure SDK.

## Services

- Wallet-signature authentication
- Mobile OTP authentication
- One primary mobile-created wallet per phone number
- External wallet linking and detach
- JWT sessions
- Notification storage and WebSocket push
- Mobile-number and wallet-address transfers
- Solana Pay payment request creation
- Solana Pay reference verification

## Local Setup

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm install
npx prisma generate
npm run dev
```

## Environment

```env
PORT=3001
DATABASE_URL="mongodb+srv://user:password@cluster.mongodb.net/solana-app-infra"
JWT_SECRET="replace-with-a-long-random-secret"
ENCRYPTION_KEY="replace-with-a-long-random-secret"
SOLANA_RPC_URL="https://api.devnet.solana.com"
MERCHANT_WALLET_ADDRESS=""
```

## Main API Groups

- `/api/auth/*`
- `/api/notifications/*`
- `/api/payments/send`
- `/api/infra/payments/*`
- `/ws?token=<jwt>`

See the frontend repo docs for the full API reference and hackathon submission narrative.
