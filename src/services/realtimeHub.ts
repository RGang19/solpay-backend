import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket } from 'ws';

type ClientMessage = {
  type: string;
  payload: unknown;
};

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';
const clientsByUser = new Map<string, Set<WebSocket>>();

const sendJson = (socket: WebSocket, message: ClientMessage) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

export const pushToUser = (userId: string, type: string, payload: unknown) => {
  const clients = clientsByUser.get(userId);
  if (!clients) return;

  for (const socket of clients) {
    sendJson(socket, { type, payload });
  }
};

export const attachRealtimeServer = (server: Server) => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(1008, 'Missing token');
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      const userClients = clientsByUser.get(decoded.userId) || new Set<WebSocket>();
      userClients.add(socket);
      clientsByUser.set(decoded.userId, userClients);

      sendJson(socket, {
        type: 'connected',
        payload: { userId: decoded.userId, message: 'Realtime notification stream connected' },
      });

      socket.on('close', () => {
        userClients.delete(socket);
        if (userClients.size === 0) {
          clientsByUser.delete(decoded.userId);
        }
      });
    } catch {
      socket.close(1008, 'Invalid token');
    }
  });
};
