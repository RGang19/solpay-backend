import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payments.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';
import paymentRequestsRoutes from './routes/paymentRequests.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/user', userRoutes);
app.use('/api/requests', paymentRequestsRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (req: Request, res: Response) => {
  res.status(200).send('SolPay Backend is live');
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (0.0.0.0)`);
});
