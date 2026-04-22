# Solana App Infrastructure SDK — Backend

Express + TypeScript backend for the Solana App Infrastructure SDK. Provides wallet authentication, mobile OTP login, multi-wallet management, real-time notifications, and Solana Pay integration.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Express + TypeScript API                         │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │
│  │  Auth        │  │ Notifications│  │  Payments                   │ │
│  │  Service     │  │ Service      │  │  Service                    │ │
│  │             │  │              │  │                             │ │
│  │ • Wallet    │  │ • Store      │  │ • SOL / SPL transfers      │ │
│  │   Signature │  │ • WebSocket  │  │ • Solana Pay requests      │ │
│  │ • Mobile    │  │   Push       │  │ • Reference verification   │ │
│  │   OTP       │  │ • Read state │  │ • Phone → wallet lookup    │ │
│  │ • JWT       │  │              │  │                             │ │
│  │ • Multi-    │  │              │  │                             │ │
│  │   wallet    │  │              │  │                             │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬────────────────┘ │
│         └────────────────┴────────────────────────┘                  │
│                          │                                           │
│              ┌───────────┴───────────┐                               │
│              │    Prisma ORM         │                               │
│              └───────────┬───────────┘                               │
└──────────────────────────┼───────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     ┌────────────────┐      ┌──────────────────┐
     │   MongoDB       │      │  Solana RPC       │
     │   Atlas         │      │  (Devnet/Mainnet) │
     └────────────────┘      └──────────────────┘
```

## Services

- Wallet-signature authentication (Ed25519 verification with nonce challenges)
- Mobile OTP authentication (random 6-digit OTP per request)
- One primary mobile-created wallet per phone number
- Attach up to 10 external wallets via signed message verification
- External wallet linking and detach
- JWT sessions with expiration
- Notification storage and WebSocket push
- Mobile-number and wallet-address transfers
- Solana Pay payment request creation
- Solana Pay reference verification

## Security

- **Rate Limiting**: Auth (10 req/15min), Payments (20 req/15min), General API (100 req/15min)
- **Env Validation**: Fails fast at startup if `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_KEY` are missing
- **CORS**: Whitelist-based origin policy
- **Helmet**: HTTP security headers
- **Wallet Auth**: Ed25519 signature verification — no transactions sent
- **OTP**: Random 6-digit code per request (not hardcoded)

## Local Setup

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm install
cp .env.example .env  # Fill in your values
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

## Project Structure

```txt
src/
├── index.ts              # App entry, middleware, rate limiting, env validation
├── routes/
│   ├── auth.ts           # Wallet login, mobile OTP, wallet attach/detach
│   ├── payments.ts       # SOL/USDC transfers
│   ├── transactions.ts   # Transaction history (DB + on-chain)
│   ├── users.ts          # User profile and balance
│   ├── notifications.ts  # Notification CRUD
│   ├── infraPayments.ts  # Solana Pay requests
│   └── paymentRequests.ts
├── services/
│   ├── walletService.ts  # Keypair generation and encryption
│   ├── sessionService.ts # JWT session management
│   ├── realtimeHub.ts    # WebSocket notification push
│   └── solanaPayService.ts
├── middleware/
│   └── authMiddleware.ts # JWT token verification
└── config/
    └── db.ts             # Prisma client
prisma/
└── schema.prisma         # MongoDB schema
```

## Main API Groups

- `/api/auth/*` — Wallet login, mobile OTP, wallet attach/detach, session
- `/api/notifications/*` — Notification CRUD and WebSocket stream
- `/api/payments/send` — SOL/USDC transfers by phone or wallet address
- `/api/infra/payments/*` — Solana Pay request creation and verification
- `/api/user/*` — User profile and balance
- `/api/transactions/*` — Transaction history
- `/ws?token=<jwt>` — Real-time notification WebSocket

See the [frontend repo](https://github.com/RGang19/solpay-frontend) for the full API reference and SDK documentation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, commit conventions, and PR process.

## License

MIT — see [LICENSE](LICENSE) for details.
