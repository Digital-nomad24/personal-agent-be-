import { Router } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import dotenv from 'dotenv';
import axios from 'axios';
import { generateToken } from './auth';
import { sendTelegramMessage } from '../services/telegramService';
import {meetingExtractPrompt, taskExtractPrompt} from '../utils/prompts'
dotenv.config();

const telegramRouter = Router();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const REMINDER_API_URL = 'http://localhost:8000/api/v1/openai/extract-task'
const API_BASE_URL='http://localhost:8000/api/v1'
if (!TELEGRAM_BOT_TOKEN) {
  console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is not defined in environment variables.");
  process.exit(1);
}
function calculatePriorityOrder(priority: string): number {
  const priorityMap = {
    'high': 1,
    'medium': 2,
    'low': 3
  };
  return priorityMap[priority as keyof typeof priorityMap] || 2;
}
// --- NEW: Web App Connect API --- //
telegramRouter.post('/connect', async (req, res) => {

  const { telegramId, telegramChatId, email, password, provider } = req.body;
   console.log("REACHED THE TELEGRAM ROUTE")
  if (!telegramId || !telegramChatId || !email) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    console.log(user)
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    if (
      user.telegramChatId && 
      user.telegramChatId !== String(telegramChatId)
    ) {
      return res.status(409).json({
        error: "Account already linked to another Telegram chat. Contact support to change it."
      });
    }

    // Password check only for local provider
    if ((user.provider === "local" || !user.provider) && user.password) {
      if (!password) {
        return res.status(400).json({ error: "Password required for this account." });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid password." });
      }
    } else if (user.provider === "google") {
      if (password) {
        return res.status(400).json({ error: "This Google account doesn't require a password." });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: String(telegramChatId) }
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Error linking Telegram:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// --- CLEANED TELEGRAM BOT WEBHOOK --- //
// Replace your webhook function with this enhanced version for debugg








telegramRouter.post('/webhook', async (req, res) => {
  console.log("=".repeat(50));
  console.log("👉 Telegram Webhook Triggered at:", new Date().toISOString());
  console.log("📨 Full Request Body:", JSON.stringify(req.body, null, 2));

  const message = req.body.message;
  const callbackQuery = req.body.callback_query;

  // Handle inline button callbacks
  if (callbackQuery) {
    console.log("🎯 Callback Query Received:", JSON.stringify(callbackQuery, null, 2));
    const callbackData = callbackQuery.data;
    const callbackChatId = callbackQuery.message.chat.id;

    try {
      // Confirm Reminder Example (keep this if needed)
      if (callbackData.startsWith("confirm_reminder:")) {
        const taskId = callbackData.split(":")[1];
        await axios.put(`${API_BASE_URL}/tasks/${taskId}`, { status: 'confirmed' });
        await sendTelegramMessage(callbackChatId, `✅ Task confirmed!`);
      }

      // Book Meeting Slot
      if (callbackData.startsWith("book_slot:")) {
        const [, selectedSlot, requestId] = callbackData.split(":");

        const confirmResponse = await axios.post(`${API_BASE_URL}/gmail/confirm`, {
          requestId,
          selectedSlot
        });

        await sendTelegramMessage(callbackChatId, `📅 Meeting booked at **${selectedSlot}**!\n\n✅ Confirmation: ${confirmResponse.data.message || 'Success'}`);
      }

      return res.status(200).send("Callback handled");
    } catch (err) {
      console.error("❌ Error handling callback:", err);
      return res.status(500).send("Error processing callback query");
    }
  }

  if (!message || !message.chat || !message.text) {
    return res.status(200).send("Ignored: Incomplete message");
  }

  const chatId = message.chat.id;
  const fullText = message.text.trim();
  const command = fullText.split(" ")[0].toLowerCase();

  // Test reply to confirm message handling
  await sendTelegramMessage(chatId, `🤖 I received: "${fullText}"`);

  if (command === '/remind') {
  console.log('🔔 Processing REMIND command');
  try {
    // Check if user is authenticated
    const user = await prisma.user.findFirst({
      where: { telegramChatId: String(chatId) },
      select: {
        id: true,
        email: true,
        name: true,
        telegramChatId: true
      }
    });
   
    if (!user) {
      await sendTelegramMessage(chatId,
        '🔐 **Authentication Required**\n\n' +
        'You need to connect your account first before using reminders.\n\n' +
        '**Connection Commands:**\n' +
        '• For Google users: `/start [your_email]`\n' +
        '• For password users: `/start [your_email] [your_password]`\n\n' +
        '**Examples:**\n' +
        '• `/start john@gmail.com`\n' +
        '• `/start john@example.com mypassword123`\n\n' +
        '✨ Once connected, you can use `/remind` to set reminders!'
      );
      return res.status(200).send("User not authenticated for reminder");
    }
   
    // Get the reminder message (everything after /remind)
    const reminderMessage = fullText.replace(/^\/remind\s+/i, '').trim();
   
    if (!reminderMessage) {
      await sendTelegramMessage(chatId,
        '⚠️ **No reminder message provided**\n\n' +
        '**Example:** `/remind Call mom tomorrow`'
      );
      return res.status(200).send("No reminder message");
    }
   
    console.log("🔄 Extracting task from message:", reminderMessage);
    
    // Extract task using the extraction API
    try {
      const extractionResponse = await axios.post(`${API_BASE_URL}/openai/extract-task`, {
        message: reminderMessage,
        systemPrompt: taskExtractPrompt
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      
      const { isTask, task, message: aiMessage } = extractionResponse.data;
      
      if (!isTask || !task) {
        await sendTelegramMessage(chatId,
          `🤖 **AI Response:**\n\n${aiMessage || 'Could not extract task from your message. Please try rephrasing.'}`
        );
        return res.status(200).send("Not a valid task");
      }
      
      console.log("✅ Task extracted successfully:", task);
      
      // Create task with updated schema
      const token = generateToken(user.id);
      const taskPayload = {
        title: task.title,
        description: task.description || '',
        status: task.status || 'pending',
        priority: task.priority,
        priorityOrder: calculatePriorityOrder(task.priority),
        dueDate: task.dueDate,
        userId: user.id,
        meetingMetadata: null
      };
      
      await axios.post('http://localhost:8000/api/v1/tasks', taskPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
     
      await sendTelegramMessage(chatId,
        `✅ **Reminder Set Successfully!**\n\n` +
        `📝 **Task:** ${task.title}\n` +
        `📄 **Description:** ${task.description || 'None'}\n` +
        `⚡ **Priority:** ${task.priority}\n` +
        `📅 **Due Date:** ${task.dueDate || 'Not specified'}`
      );
     
    } catch (apiError: any) {
      console.error("❌ Error with task extraction/creation:", apiError.response?.data || apiError.message);
     
      await sendTelegramMessage(chatId,
        '❌ **Failed to Set Reminder**\n\n' +
        'Something went wrong. Please try again later.'
      );
    }
   
    return res.status(200).send("Reminder command processed");
   
  } catch (error) {
    console.error("❌ Error processing reminder:", error);
   
    await sendTelegramMessage(chatId,
      '❌ **System Error**\n\n' +
      'Something went wrong processing your reminder. Please try again.'
    );
   
    return res.status(200).send("Error in reminder processing");
  }
}

  if (command === '/meet') {
    console.log('📅 Processing MEET command');

    try {
      const user = await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, email: true, name: true, telegramChatId: true }
      });

      if (!user) {
        await sendTelegramMessage(chatId, '🔐 You need to connect your account first using `/start [email]`.');
        return res.status(200).send("User not authenticated for meeting");
      }

      const meetingMessage = fullText.replace(/^\/meet\s+/i, '').trim();

      if (!meetingMessage) {
        await sendTelegramMessage(chatId, '⚠️ Please provide meeting details.\n_Example: `/meet Schedule sync with john@example.com for 30min next week`_');
        return res.status(200).send("No meeting message");
      }

      const extractionResponse = await axios.post(`${API_BASE_URL}/openai/extract-meeting`, {
        message: meetingMessage,
        systemPrompt: meetingExtractPrompt
      });

      const { isMeeting, meeting, message: aiMessage } = extractionResponse.data;

      if (!isMeeting || !meeting) {
        await sendTelegramMessage(chatId, `🤖 AI Response:\n\n${aiMessage || 'Could not extract meeting details.'}`);
        return res.status(200).send("Invalid meeting");
      }

      const token = generateToken(user.id);

      const meetingRequestPayload = {
        title: meeting.title,
        description: meeting.description || '',
        duration: meeting.duration,
        targetEmail: meeting.targetEmail,
        purpose: meeting.purpose || '',
        preferredTimeframe: meeting.preferredTimeframe || 'this week',
        location: meeting.location,
        meetingLink: meeting.meetingLink,
        requesterUserId: user.id
      };

      const meetingResponse = await axios.post(`${API_BASE_URL}/gmail/request`, meetingRequestPayload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const { requestId, slots } = meetingResponse.data;

      if (!slots || slots.length === 0) {
        await sendTelegramMessage(chatId, `✅ Meeting request created!\nNo free slots found. The recipient can still manually accept.`);
      } else {
        // Show inline buttons for slot selection
        const inlineKeyboard = slots.map((slot:any) => [
          {
            text: `${slot}`, // Example: "Tue 3PM"
            callback_data: `book_slot:${slot}:${requestId}`
          }
        ]);

        await sendTelegramMessage(chatId,
          `✅ **Meeting Request Created!**\n\n` +
          `📝 **Title:** ${meeting.title}\n` +
          `👤 **With:** ${meeting.targetEmail}\n` +
          `⏱️ **Duration:** ${meeting.duration} minutes\n\n` +
          `📅 **Choose a slot to confirm:**`,
          {
            reply_markup: { inline_keyboard: inlineKeyboard }
          }
        );
      }

      return res.status(200).send("Meeting command processed");
    } catch (error: any) {
      console.error("❌ Error scheduling meeting:", error.response?.data || error.message);
      await sendTelegramMessage(chatId, '❌ Failed to schedule meeting. Please try again later.');
      return res.status(500).send("Error scheduling meeting");
    }
  }

  if (command === '/help') {
    await sendTelegramMessage(chatId,
      '🛠️ **Help Menu**\n\n' +
      'Available commands:\n' +
      '• `/remind <message>` — Set a reminder\n' +
      '• `/meet <details>` — Schedule a meeting\n' +
      '• `/help` — Show this menu'
    );
    return res.status(200).send("Help command processed");
  }

  // Fallback for unknown commands
  await sendTelegramMessage(chatId,
    '❓ Unknown command.\n\nType `/help` to see available options.'
  );
  return res.status(200).send("Unknown command processed");
});

export default telegramRouter;
