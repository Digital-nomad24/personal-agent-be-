import cron from 'node-cron';
import prisma from '../utils/prisma';
import { publishReminder, createReminderPayloadFromNotification } from '../pubsub/publisher';

export function startReminderCron() {
  console.log("CRON JOB RUNNING");

  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);

    try {
      const dueTasks = await prisma.task.findMany({
        where: {
          dueDate: {
            gte: now,
            lte: fiveMinutesLater,
          },
          status: 'pending',
          NOT: {
            dueDate: null,
          },
        },
        include: {
          user: true,
        },
      });

      for (const task of dueTasks) {
        // Check if notification already exists for this task and user
        const existingNotification = await prisma.notification.findFirst({
          where: {
            taskId: task.id,
            userId: task.userId,
          },
        });

        if (existingNotification) {
          console.log(`🔁 Notification already exists for task: ${task.id}`);
          continue;
        }

        // Create notification entry
        const newNotification = await prisma.notification.create({
          data: {
            message: `Reminder: ${task.title}`,
            type: 'default',
            dueDate: task.dueDate!,
            userId: task.userId,
            taskId: task.id,
          },
        });

        const reminderPayload = createReminderPayloadFromNotification(newNotification, task);
        await publishReminder(reminderPayload);


        console.log(`📨 Published and stored reminder for task: ${task.id}`);
      }

      if (dueTasks.length > 0) {
        console.log(`⏰ Processed ${dueTasks.length} due tasks for reminders`);
      }

    } catch (err) {
      console.error('❌ Error in reminder cron job:', err);
    }
  });

  console.log('⏰ Reminder cron job started. Runs every minute.');
}
