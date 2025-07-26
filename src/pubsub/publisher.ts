import { TaskStatus, TaskPriority, Notification } from '@prisma/client';
import { pubsub } from '../utils/pubsubClient';

const topicName = 'task-notifications';

export type ReminderPayload = {
  notificationId: string;
  userId: string;
  taskId: string;
  title: string;
  dueTime: string; // ISO string format
  priority: TaskPriority;
};

export type TaskWithUser = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  priorityOrder: number;
  dueDate: Date | null;
  completionDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

// ✅ publishReminder
export async function publishReminder(payload: ReminderPayload): Promise<string> {
  const dataBuffer = Buffer.from(JSON.stringify(payload));

  try {
    const messageId = await pubsub.topic(topicName).publish(dataBuffer);
    console.log(`✅ Reminder published: ${messageId} for task: ${payload.title}`);
    return messageId;
  } catch (error) {
    console.error('❌ Failed to publish reminder:', error);
    throw error;
  }
}

// ✅ createReminderPayloadFromNotification
export function createReminderPayloadFromNotification(
  notification: Notification,
  task: TaskWithUser
): ReminderPayload {
  return {
    notificationId: notification.id,
    userId: task.userId,
    taskId: task.id,
    title: task.title,
    dueTime: task.dueDate?.toISOString() || new Date().toISOString(),
    priority: task.priority,
  };
}
