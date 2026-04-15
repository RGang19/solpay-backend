import prisma from '../config/db.js';
import { pushToUser } from './realtimeHub.js';

export type NotificationPayload = {
  userId: string;
  type?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export const createNotification = async ({
  userId,
  type = 'system',
  title,
  body,
  data,
}: NotificationPayload) => {
  const notification = await prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      body,
      data,
    },
  });

  pushToUser(userId, 'notification.created', notification);
  return notification;
};
