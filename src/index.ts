import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
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

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// Middleware
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/user', userRoutes);
app.use('/api/requests', paymentRequestsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/infra/payments', infraPaymentRoutes);

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
