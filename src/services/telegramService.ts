import axios from 'axios';
import prisma from '../utils/prisma';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Basic message sender (backward compatible)
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    reply_markup?: any;
    parse_mode?: string;
  }
) {
  try {
    const payload: any = {
      chat_id: chatId,
      text: text,
      parse_mode: options?.parse_mode || 'Markdown',
    };

    if (options?.reply_markup) {
      payload.reply_markup = options.reply_markup;
    }

    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload, {
      timeout: 10000,
    });

    console.log(`✅ Telegram message sent to ${chatId}`);
    return response.data;

  } catch (error: any) {
    console.error('❌ Failed to send Telegram message:', error.response?.data || error.message);
    throw error;
  }
}

// Inline buttons sender
export async function sendTelegramMessageWithInlineButtons(
  chatId: string,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>
) {
  try {
    const options = {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: 'Markdown',
    };

    return await sendTelegramMessage(chatId, text, options);

  } catch (error: any) {
    console.error('❌ Failed to send Telegram message with buttons:', error);
    return await sendTelegramMessage(chatId, text);
  }
}

// Callback query responder (e.g., remove loading spinner)
export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    const payload: any = {
      callback_query_id: callbackQueryId,
    };

    if (text) {
      payload.text = text;
      payload.show_alert = false;
    }

    const response = await axios.post(`${TELEGRAM_API_URL}/answerCallbackQuery`, payload, {
      timeout: 5000,
    });

    console.log(`✅ Callback query answered: ${callbackQueryId}`);
    return response.data;

  } catch (error: any) {
    console.error('❌ Failed to answer callback query:', error.response?.data || error.message);
  }
}

// Edit message content
export async function editMessageText(
  chatId: string,
  messageId: number,
  newText: string,
  buttons?: Array<Array<{ text: string; callback_data: string }>>
) {
  try {
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown',
    };

    if (buttons) {
      payload.reply_markup = {
        inline_keyboard: buttons,
      };
    }

    const response = await axios.post(`${TELEGRAM_API_URL}/editMessageText`, payload, {
      timeout: 10000,
    });

    console.log(`✅ Message edited in chat ${chatId}`);
    return response.data;

  } catch (error: any) {
    console.error('❌ Failed to edit message:', error.response?.data || error.message);
  }
}

// Delete a message
export async function deleteMessage(chatId: string, messageId: number) {
  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/deleteMessage`, {
      chat_id: chatId,
      message_id: messageId,
    }, {
      timeout: 5000,
    });

    console.log(`✅ Message deleted from chat ${chatId}`);
    return response.data;

  } catch (error: any) {
    console.error('❌ Failed to delete message:', error.response?.data || error.message);
  }
}

// Send confirmation after successful booking
export async function sendBookingConfirmation(
  chatId: string,
  meetingDetails: {
    title: string;
    targetEmail: string;
    slot: string;
    duration: number;
    location?: string;
  }
) {
  const message = `✅ *Meeting Booked Successfully!*\n\n` +
    `📅 ${meetingDetails.slot}\n` +
    `👤 With: ${meetingDetails.targetEmail}\n` +
    `📝 ${meetingDetails.title}\n` +
    `⏱️ Duration: ${meetingDetails.duration} minutes\n` +
    (meetingDetails.location ? `📍 Location: ${meetingDetails.location}\n` : '') +
    `\n🔔 Calendar invites have been sent to both participants.`;

  return await sendTelegramMessage(chatId, message);
}

// Send generic error
export async function sendErrorNotification(chatId: string, errorMessage: string) {
  const message = `❌ *Error*\n\n${errorMessage}`;
  return await sendTelegramMessage(chatId, message);
}

// Notify user of session expiry
export async function sendSessionExpiredNotification(chatId: string) {
  const message = `⏰ *Session Expired*\n\nYour booking session has expired. Please request a new meeting to see available slots.`;
  return await sendTelegramMessage(chatId, message);
}

// Retrieve chat ID from DB using Prisma
export async function getTelegramChatIdForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });

  return user?.telegramChatId || null;
}
