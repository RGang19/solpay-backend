import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payments.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';
import paymentRequestsRoutes from './routes/paymentRequests.js';
import notificationRoutes from './routes/notifications.js';
import infraPaymentRoutes from './routes/infraPayments.js';
import { attachRealtimeServer } from './services/realtimeHub.js';

dotenv.config();

// ── Environment validation ──────────────────────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Check your .env file or environment configuration.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['https://sol-pay.netlify.app', 'http://localhost:5173', 'http://localhost:8080', 'http://localhost:3000'],
  credentials: true
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));
app.use(morgan('dev'));
app.use(express.json());

// ── Rate Limiting ───────────────────────────────────────────────────────────
// General API rate limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict rate limit for auth endpoints: 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Payment rate limit: 20 requests per 15 minutes per IP
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later.' },
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/payments', paymentLimiter, paymentRoutes);
app.use('/api/transactions', generalLimiter, transactionRoutes);
app.use('/api/user', generalLimiter, userRoutes);
app.use('/api/requests', generalLimiter, paymentRequestsRoutes);
app.use('/api/notifications', generalLimiter, notificationRoutes);
app.use('/api/infra/payments', paymentLimiter, infraPaymentRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (req: Request, res: Response) => {
  res.status(200).send('SolPay Backend is live');
});

attachRealtimeServer(server);

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (0.0.0.0)`);
});
