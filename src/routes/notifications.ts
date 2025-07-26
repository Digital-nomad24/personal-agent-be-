// src/routes/notifications.ts
import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth';
import { createNotificationInput, updateNotificationInput } from '../utils/zodSchema';

const notificationsRouter = Router();

// Get all notifications for logged-in user
notificationsRouter.get('/getAll', authMiddleware, async (req: Request, res: Response) => {
  try {
      const notifications = await prisma.notification.findMany({
      where: {
        isRead:false
       },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update `isRead` or other fields
notificationsRouter.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const data = updateNotificationInput.parse(req.body);
    console.log("NOTIFICATION ROUTES")
    console.log(data)
    const result = await prisma.notification.update({
      where: { id, userId },
      data,
    });
    console.log(result)
    console.log()

    res.status(200).json({ message: 'Notification updated.' });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    console.error('Error updating notification:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

notificationsRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const deleted = await prisma.notification.deleteMany({
      where: { id, userId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ message: 'Notification not found or unauthorized.' });
    }

    res.status(200).json({ message: 'Notification deleted.' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default notificationsRouter;
