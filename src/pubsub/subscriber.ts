import { Server } from "socket.io";
import { Subscription } from "@google-cloud/pubsub";
import { pubsub } from "../utils/pubsubClient";
import { ReminderPayload } from "./publisher";
import { getTelegramChatIdForUser, sendTelegramMessage } from "../services/telegramService";
import { v4 as uuidv4 } from 'uuid'; 
const subscriptionName = "task-notifications-sub";

export function startReminderSubscriber(
  io: Server,
  userSocketMap: Map<string, string>
): Subscription {
  const subscription = pubsub.subscription(subscriptionName);

  subscription.on("message", async (message) => {
    try {
      if (!message.data) {
        console.warn("⚠️ Received message without data");
        message.nack();
        return;
      }

      const data: ReminderPayload = JSON.parse(message.data.toString());
      console.log("📥 Received reminder:", {
        notificationId: data.notificationId,
        title: data.title,
        userId: data.userId,
        dueTime: data.dueTime,
        type: data.priority === 'high' ? 'critical' : 'default'
      });

      // Validate payload
      if (!data.userId || !data.taskId || !data.title || !data.dueTime) {
        console.warn("⚠️ Invalid reminder payload:", data);
        message.ack();
        return;
      }

      const socketId = userSocketMap.get(data.userId);
      if (socketId) {
        // Send notification in the format expected by frontend
        io.to(socketId).emit("reminder", {
          id: uuidv4(), // Generate unique notification ID
          message: `⏰ Reminder: "${data.title}" is due!`,
          type: data.priority === 'high' ? 'critical' : 'default',
          dueDate: data.dueTime,
          taskId: data.taskId
        });
        console.log(`📤 Sent reminder to socket: ${socketId} for task: ${data.title}`);
        const chatId = await getTelegramChatIdForUser(data.userId);
        if (chatId) {
          const messageText = `⏰ Reminder: "${data.title}" is due at ${new Date(data.dueTime).toLocaleString()}`;
          await sendTelegramMessage(chatId, messageText);
          console.log(`📨 Sent Telegram reminder to chatId: ${chatId}`);
        } else {
          console.warn(`⚠️ No Telegram chat ID found for userId: ${data.userId}`);
        }
      } else {
        console.warn(`⚠️ No socket connection for userId: ${data.userId}`);
        
        // 🔁 Fallback: Telegram notification
        const chatId = await getTelegramChatIdForUser(data.userId);
        if (chatId) {
          const messageText = `⏰ Reminder: "${data.title}" is due at ${new Date(data.dueTime).toLocaleString()}`;
          await sendTelegramMessage(chatId, messageText);
          console.log(`📨 Sent Telegram reminder to chatId: ${chatId}`);
        } else {
          console.warn(`⚠️ No Telegram chat ID found for userId: ${data.userId}`);
        }
      }

      message.ack();
    } catch (error) {
      console.error("❌ Error processing Pub/Sub message:", error);
      message.nack();
    }
  });

  subscription.on("error", (err) => {
    console.error("❌ Subscription error:", err);
  });

  console.log("🚀 Reminder subscriber is listening to Pub/Sub...");
  return subscription;
}

export function stopReminderSubscriber(subscription: Subscription): void {
  subscription.removeAllListeners();
  subscription.close();
  console.log("🛑 Reminder subscriber stopped");
}