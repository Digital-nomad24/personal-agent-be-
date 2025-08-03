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

// NEW /meet command
if (command === '/meet') {
  console.log('📅 Processing MEET command');
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
        'You need to connect your account first before scheduling meetings.\n\n' +
        '**Connection Commands:**\n' +
        '• For Google users: `/start [your_email]`\n' +
        '• For password users: `/start [your_email] [your_password]`\n\n' +
        '**Examples:**\n' +
        '• `/start john@gmail.com`\n' +
        '• `/start john@example.com mypassword123`\n\n' +
        '✨ Once connected, you can use `/meet` to schedule meetings!'
      );
      return res.status(200).send("User not authenticated for meeting");
    }
   
    // Get the meeting message (everything after /meet)
    const meetingMessage = fullText.replace(/^\/meet\s+/i, '').trim();
   
    if (!meetingMessage) {
      await sendTelegramMessage(chatId,
        '⚠️ **No meeting details provided**\n\n' +
        '**Example:** `/meet Schedule sync with john@example.com for 30min next week`'
      );
      return res.status(200).send("No meeting message");
    }
   
    console.log("🔄 Extracting meeting from message:", meetingMessage);
    
    // Extract meeting using the extraction API
    try {
      const extractionResponse = await axios.post(`${API_BASE_URL}/openai/extract-meeting`, {
        message: meetingMessage,
        systemPrompt: meetingExtractPrompt
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      
      const { isMeeting, meeting, message: aiMessage } = extractionResponse.data;
      
      if (!isMeeting || !meeting) {
        await sendTelegramMessage(chatId,
          `🤖 **AI Response:**\n\n${aiMessage || 'Could not extract meeting details from your message. Please try rephrasing.'}`
        );
        return res.status(200).send("Not a valid meeting request");
      }
      
      console.log("✅ Meeting extracted successfully:", meeting);
      
      // Create meeting request (this would trigger the calendar access flow)
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
      
      console.log(meetingRequestPayload)
      const meetingResponse = await axios.post(`http://localhost:8000/api/v1/gmail/request`, meetingRequestPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const { requestId } = meetingResponse.data;
     
      await sendTelegramMessage(chatId,
        `✅ **Meeting Request Created!**\n\n` +
        `📝 **Title:** ${meeting.title}\n` +
        `👤 **With:** ${meeting.targetEmail}\n` +
        `⏱️ **Duration:** ${meeting.duration} minutes\n` +
        `📅 **Timeframe:** ${meeting.preferredTimeframe}\n` +
        `🎯 **Purpose:** ${meeting.purpose || 'Not specified'}\n\n` +
        `📧 **Next Step:** Calendar access request sent to ${meeting.targetEmail}\n` +
        `🔄 **Request ID:** ${requestId}`
      );
     
    } catch (apiError: any) {
      console.error("❌ Error with meeting extraction/creation:", apiError.response?.data || apiError.message);
     
      await sendTelegramMessage(chatId,
        '❌ **Failed to Schedule Meeting**\n\n' +
        'Something went wrong. Please try again later.'
      );
    }
   
    return res.status(200).send("Meeting command processed");
   
  } catch (error) {
    console.error("❌ Error processing meeting:", error);
   
    await sendTelegramMessage(chatId,
      '❌ **System Error**\n\n' +
      'Something went wrong processing your meeting request. Please try again.'
    );
   
    return res.status(200).send("Error in meeting processing");
  }
} else if (command === '/help') {
  await sendTelegramMessage(chatId,
    '🛠️ **Help Menu**\n\n' +
    'Here are the available commands you can use:\n\n' +
    '• `/remind <time> <message>`\n' +
    '  Set a reminder.\n' +
    '  _Example:_ `/remind 10m Take a break`\n\n' +
    '• `/meet <email>`\n' +
    '  Schedule a meeting with someone by sending them a calendar access link.\n' +
    '  _Example:_ `/meet someone@example.com`\n\n' +
    '• `/help`\n' +
    '  Show this help menu.'
  );
  return res.status(200).send("Help command processed");

} else {
  console.log('❓ Unknown command:', command);

  await sendTelegramMessage(chatId,
    '❓ **Unknown Command**\n\n' +
    'Available commands:\n' +
    '• `/remind` - Set a reminder\n' +
    '• `/meet` - Schedule a meeting\n' +
    '• `/help` - Show help\n\n' +
    'Type `/help` to learn how to use them.'
  );
  return res.status(200).send("Unknown command processed");
}
  
});

export default telegramRouter;
