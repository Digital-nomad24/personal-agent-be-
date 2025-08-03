import { Router } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import dotenv from 'dotenv';
import axios from 'axios';
import { generateToken } from './auth';
import { sendTelegramMessage } from '../services/telegramService';
import {meetingExtractPrompt, taskExtractPrompt} from '../utils/prompts'
import { createCalendarEvent } from '../utils/approve-callback.utils';
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
  
  // ✅ NEW: Handle callback queries (button clicks) FIRST
  const callbackQuery = req.body.callback_query;
  if (callbackQuery) {
    console.log("🔘 Processing Callback Query:");
    console.log("  - Callback Data:", callbackQuery.data);
    console.log("  - Chat ID:", callbackQuery.message.chat.id);
    console.log("  - Message ID:", callbackQuery.message.message_id);
    console.log("  - User:", callbackQuery.from.username || callbackQuery.from.first_name);
    
    try {
      await handleSlotSelection(
        callbackQuery.data,
        callbackQuery.message.chat.id.toString(),
        callbackQuery.message.message_id.toString()
      );
      
      // Always acknowledge the callback query
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
        { 
          callback_query_id: callbackQuery.id,
          text: "Processing your selection..." // Optional notification
        }
      );
      
      console.log("✅ Callback query processed successfully");
      return res.status(200).send("Callback query processed");
      
    } catch (error: any) {
      console.error("❌ Error processing callback query:", error);
      
      // Acknowledge with error message
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
        { 
          callback_query_id: callbackQuery.id,
          text: "❌ Error processing selection. Please try again.",
          show_alert: true
        }
      );
      
      return res.status(200).send("Callback query error");
    }
  }
  
  // ✅ EXISTING: Handle regular text messages
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

  // ✅ EXISTING: All your existing command handlers
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

// ✅ NEW: Add the slot selection handler functions
async function handleSlotSelection(callbackData: string, chatId: string, messageId: string) {
  console.log(`🎯 [SLOT SELECTION] Handling callback: ${callbackData}`);
  
  try {
    const [action, slotOfferId, slotIndex] = callbackData.split(':');
    
    if (action === 'select_slot') {
      await processSlotSelection(slotOfferId, parseInt(slotIndex), chatId, messageId);
    } else if (action === 'cancel_slots') {
      await processCancelSlots(slotOfferId, chatId, messageId);
    } else if (action === 'refresh_slots') {
      await processRefreshSlots(slotOfferId, chatId, messageId);
    }
    
  } catch (error: any) {
    console.error(`❌ [SLOT SELECTION ERROR] Error handling selection:`, error.message);
    
    // Send error message to user
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ **Error processing your selection**\n\nPlease try again or contact support.`,
        parse_mode: 'Markdown'
      }
    );
  }
}

async function processSlotSelection(slotOfferId: string, slotIndex: number, chatId: string, messageId: string) {
  console.log(`🎯 [PROCESS SELECTION] Processing slot ${slotIndex} for offer ${slotOfferId}`);
  
  try {
    // Get SlotOffer with related data
    const slotOffer = await prisma.slotOffer.findUnique({
      where: { id: slotOfferId },
      include: {
        accessRequest: {
          include: {
            requesterUser: true,
            meetingRequests: true
          }
        },
        meetingRequest: true
      }
    });

    if (!slotOffer || slotOffer.status !== 'active') {
      throw new Error('Slot offer not found or no longer active');
    }

    // Check if expired
    if (new Date() > slotOffer.expiresAt) {
      throw new Error('Slot offer has expired');
    }

    // Get the selected slot
    const offeredSlots = slotOffer.offeredSlots as { start: string; end: string }[];
    const selectedSlot = offeredSlots[slotIndex];
    
    if (!selectedSlot) {
      throw new Error('Invalid slot selection');
    }

    console.log(`✅ [PROCESS SELECTION] Selected slot:`, selectedSlot);

    // Update SlotOffer status and selected slot
    await prisma.slotOffer.update({
      where: { id: slotOfferId },
      data: {
        status: 'booked',
        selectedSlotIndex: slotIndex
      }
    });

    // Create the calendar event (you'll need to import this function)
    const meetingData = {
      title: slotOffer.accessRequest.purpose,
      description: slotOffer.accessRequest.purpose,
      duration: slotOffer.accessRequest.preferredDuration || 30,
      purpose: slotOffer.accessRequest.purpose,
      location: slotOffer.accessRequest.location
    };

    // You'll need to import createCalendarEvent from your meeting processing file
    const bookingResult = await createCalendarEvent(
      meetingData, 
      selectedSlot, 
      slotOffer.accessRequest.targetEmail, 
      slotOffer.accessRequest.requesterUserId
    );

    if (bookingResult.success) {
      // Create Meeting record
      const meeting = await prisma.meeting.create({
        data: {
          title: meetingData.title,
          description: meetingData.description,
          startTime: new Date(selectedSlot.start),
          endTime: new Date(selectedSlot.end),
          duration: meetingData.duration,
          location: meetingData.location,
          status: 'confirmed',
          organizerId: slotOffer.accessRequest.requesterUserId,
          externalAttendeeEmail: slotOffer.accessRequest.targetEmail,
          googleEventId: bookingResult.eventId || null,
        }
      });

      // Link meeting to MeetingRequest
      if (slotOffer.meetingRequest) {
        await prisma.meetingRequest.update({
          where: { id: slotOffer.meetingRequest.id },
          data: { meetingId: meeting.id }
        });
      }

      // Update Telegram message with success
      const startTime = new Date(selectedSlot.start).toLocaleString();
      
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
        {
          chat_id: chatId,
          message_id: messageId,
          text: 
            `🎉 **Meeting Confirmed!**\n\n` +
            `📝 **Meeting:** ${meetingData.title}\n` +
            `👤 **With:** ${slotOffer.accessRequest.targetEmail}\n` +
            `📅 **Date & Time:** ${startTime}\n` +
            `⏱️ **Duration:** ${meetingData.duration} minutes\n\n` +
            `✅ Calendar invites have been sent to both parties!`,
          parse_mode: 'Markdown'
        }
      );

      console.log(`🎉 [PROCESS SELECTION] Meeting successfully created: ${meeting.id}`);

    } else {
      throw new Error(`Failed to create calendar event: ${bookingResult.error}`);
    }

  } catch (error: any) {
    console.error(`❌ [PROCESS SELECTION ERROR] Error:`, error.message);
    
    // Update Telegram message with error
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ **Meeting Booking Failed**\n\n**Error:** ${error.message}\n\nPlease try again or contact support.`,
        parse_mode: 'Markdown'
      }
    );
  }
}

async function processCancelSlots(slotOfferId: string, chatId: string, messageId: string) {
  try {
    // Update SlotOffer status to cancelled
    await prisma.slotOffer.update({
      where: { id: slotOfferId },
      data: { status: 'cancelled' }
    });

    // Update message
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ **Meeting Request Cancelled**\n\nYou can create a new meeting request anytime using \`/meet\`.`,
        parse_mode: 'Markdown'
      }
    );
  } catch (error: any) {
    console.error('Error cancelling slots:', error);
  }
}

async function processRefreshSlots(slotOfferId: string, chatId: string, messageId: string) {
  try {
    // For now, just send a message saying refresh is not implemented
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `🔄 **Refresh Slots**\n\nRefresh functionality coming soon! For now, please create a new meeting request using \`/meet\`.`,
        parse_mode: 'Markdown'
      }
    );
  } catch (error: any) {
    console.error('Error refreshing slots:', error);
  }
}

export default telegramRouter;
