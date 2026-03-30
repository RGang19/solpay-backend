import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

delete process.env.PRISMA_CLIENT_ENGINE_TYPE;
const prisma = new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });

export default prisma;
