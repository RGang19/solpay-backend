import { Router } from 'express';
import type { Response } from 'express';
import prisma from '../config/db.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import type { AuthRequest } from '../middleware/authMiddleware.js';
import { createNotification } from '../services/notificationService.js';

const router = Router();

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const notifications = await prisma.notification.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  res.status(200).json({ notifications });
});

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { userId, type, title, body, data } = req.body;
  const targetUserId = userId || req.user?.userId;

  if (!targetUserId || !title || !body) {
    return res.status(400).json({ error: 'userId, title, and body are required' });
  }

  const notification = await createNotification({
    userId: targetUserId,
    type,
    title,
    body,
    data,
  });

  res.status(201).json({ notification });
});

router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const notificationId = req.params.id;
  const { read } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!notificationId || Array.isArray(notificationId)) {
    return res.status(400).json({ error: 'Notification id is required' });
  }
  if (typeof read !== 'boolean') return res.status(400).json({ error: 'read must be boolean' });

  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, user_id: userId },
  });
  if (!existing) return res.status(404).json({ error: 'Notification not found' });

  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { read },
  });

  res.status(200).json({ notification });
});

export default router;
