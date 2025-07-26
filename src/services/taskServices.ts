// import { PrismaClient } from '@prisma/client';
// import { publishReminder, createReminderPayloadFromNotification } from '../pubsub/publisher';

// const prisma = new PrismaClient();

// export async function createTaskWithReminder(
//   userId: string,
//   taskData: {
//     title: string;
//     description?: string;
//     priority: 'high' | 'medium' | 'low';
//     priorityOrder: number;
//     dueDate?: Date;
//   }
// ) {
//   try {
//     const task = await prisma.task.create({
//       data: {
//         ...taskData,
//         userId,
//       },
//       include: {
//         user: {
//           select: {
//             id: true,
//             name: true,
//             email: true,
//           }
//         }
//       }
//     });

//     // Schedule reminder if dueDate is set
//     if (task.dueDate) {
//       const reminderPayload = createReminderPayload(task);
//       await publishReminder(reminderPayload);
//     }

//     return task;
//   } catch (error) {
//     console.error('Error creating task with reminder:', error);
//     throw error;
//   }
// }

// export async function getTasksDueForReminder(minutes: number = 15) {
//   const now = new Date();
//   const reminderTime = new Date(now.getTime() + minutes * 60 * 1000);
  
//   return await prisma.task.findMany({
//     where: {
//       status: 'pending',
//       dueDate: {
//         gte: now,
//         lte: reminderTime,
//       }
//     },
//     include: {
//       user: {
//         select: {
//           id: true,
//           name: true,
//           email: true,
//         }
//       }
//     }
//   });
// }