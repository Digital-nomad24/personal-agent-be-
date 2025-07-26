import { Router } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import dotenv from 'dotenv';
import axios from 'axios';
import { generateToken } from './auth';
import { sendTelegramMessage } from '../services/telegramService';
dotenv.config();

const telegramRouter = Router();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const REMINDER_API_URL = 'http://localhost:8000/api/v1/openai/extract-task'
if (!TELEGRAM_BOT_TOKEN) {
  console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is not defined in environment variables.");
  process.exit(1);
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
// Replace your webhook function with this enhanced version for debugging:

telegramRouter.post('/webhook', async (req, res) => {
  console.log("=".repeat(50));
  console.log("👉 Telegram Webhook Triggered at:", new Date().toISOString());
  console.log("📨 Full Request Body:", JSON.stringify(req.body, null, 2));
  
  const message = req.body.message;
  
  // Enhanced logging
  console.log("📋 Message Details:");
  console.log("  - Message exists:", !!message);
  console.log("  - Chat exists:", !!message?.chat);
  console.log("  - Text:", message?.text);
  console.log("  - Chat ID:", message?.chat?.id);
  console.log("  - Message ID:", message?.message_id);
  console.log("  - From User:", message?.from?.username || message?.from?.first_name);
  
  if (!message || !message.chat || !message.text) {
    console.log("❌ Incomplete message - ignoring");
    return res.status(200).send("Ignored: Incomplete message");
  }

  const chatId = message.chat.id;
  const fullText = message.text.trim();
  const command = fullText.split(" ")[0].toLowerCase();
  
  console.log("🔍 Parsed Command Details:");
  console.log("  - Full Text:", fullText);
  console.log("  - Command:", command);
  console.log("  - Chat ID:", chatId);
  
  // Add a simple test response to every message first
  try {
    await sendTelegramMessage(chatId, `🤖 I received: "${fullText}"`);
    console.log("✅ Test response sent successfully");
  } catch (testError) {
    console.error("❌ Failed to send test response:", testError);
  }

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
      
      const reminderPayload = {
        userId: user.id,
        message: reminderMessage,
        telegramChatId: chatId,
        userEmail: user.email,
        userName: user.name,
        timestamp: new Date().toISOString()
      };
      
      console.log("🔄 Sending reminder to API:", reminderPayload);
      
      // Send to your reminder API
      try {
        const response = await axios.post(REMINDER_API_URL, reminderPayload, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TelegramReminderBot/1.0'
          },
          timeout: 30000 
        });
        
        console.log("✅ Reminder sent to API successfully:", response.data);
        const taskData = response.data.task;
        
        if (!taskData || !taskData.title || !taskData.priority) {
          throw new Error("Incomplete response from assistant");
        }
        
        const token = generateToken(user.id);

        await axios.post('http://localhost:8000/api/v1/tasks',
          {
            title: taskData.title,
            priority: taskData.priority.toLowerCase(),
            status: 'pending',
            dueDate: taskData.dueDate || null,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        await sendTelegramMessage(chatId, 
          `✅ **Reminder Set Successfully!**\n\n` +
          `📝 **Task:** ${taskData.title}\n` +
          `⚡ **Priority:** ${taskData.priority}\n` +
          `📅 **Due Date:** ${taskData.dueDate || 'Not specified'}`
        );
        
      } catch (apiError: any) {
        console.error("❌ Error with reminder API:", apiError.response?.data || apiError.message);
        
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
    
  } else if (command === '/start') {
    console.log('🚀 Processing START command');
    await sendTelegramMessage(chatId, 'Start command received - handler needed!');
    return res.status(200).send("Start command processed");
    
  } else {
    console.log('❓ Unknown command:', command);
    
    await sendTelegramMessage(chatId,
      '❓ **Unknown Command**\n\n' +
      'Available commands:\n' +
      '• `/remind` - Set a reminder\n' +
      '• `/help` - Show help'
    );
    return res.status(200).send("Unknown command processed");
  }
  
});

export default telegramRouter;
