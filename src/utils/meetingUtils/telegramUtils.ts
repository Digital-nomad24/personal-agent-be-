import axios from 'axios';
import { sendTelegramMessage as baseSendTelegramMessage } from '../../services/telegramService';
export async function sendTelegramSlotSelection(
  chatId: string,
  meetingData: any,
  targetEmail: string,
  availableSlots: Array<{start: string, end: string}>,
  slotOfferId: string,
  messageId?: string,
  isRefresh?: boolean
) {
  console.log(`📱 [TELEGRAM SLOT MSG] Sending slot selection to chat: ${chatId}`);
  
  try {
    // Format the message
    const messageText = 
      `📅 **${isRefresh ? 'Updated Meeting Slots!' : 'Meeting Slots Available!'}**\n\n` +
      `📝 **Meeting:** ${meetingData.title}\n` +
      `👤 **With:** ${targetEmail}\n` +
      `⏱️ **Duration:** ${meetingData.duration} minutes\n` +
      `🎯 **Purpose:** ${meetingData.purpose || 'Not specified'}\n\n` +
      `${isRefresh ? '🔄 **Refreshed slots** -' : '✨ **Calendar access approved!**'} Please select your preferred time slot:`;

    // Create inline keyboard buttons for each slot
    const buttons = [];
    
    // Add slot buttons (max 6 slots for better UX)
    for (let i = 0; i < Math.min(availableSlots.length, 6); i++) {
      const slot = availableSlots[i];
      const startTime = new Date(slot.start);
      const endTime = new Date(slot.end);
      
      const dateStr = startTime.toLocaleDateString('en-GB', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
      });
      const timeStr = `${startTime.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })}-${endTime.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })}`;
      
      buttons.push({
        text: `📅 ${dateStr} ${timeStr}`,
        callback_data: `select_slot:${slotOfferId}:${i}`
      });
    }

    // Arrange buttons in rows of 2
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }

    // Add action buttons
    keyboard.push([
      { text: `🔄 ${isRefresh ? 'Refresh Again' : 'Refresh Slots'}`, callback_data: `refresh_slots:${slotOfferId}` },
      { text: "❌ Cancel", callback_data: `cancel_slots:${slotOfferId}` }
    ]);

    const payload = {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    };

    // Send message or edit existing message
    if (messageId) {
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
        { ...payload, message_id: messageId }
      );
    } else {
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        payload
      );
    }

    console.log(`✅ [TELEGRAM SLOT MSG] Slot selection message sent successfully`);
    
  } catch (error: any) {
    console.error(`❌ [TELEGRAM SLOT MSG ERROR] Failed to send slot selection:`, error.response?.data || error.message);
  }
}

export async function notifyNoAvailableSlots(meetingRequest: any, requester: any) {
  console.log(`📱 [NOTIFICATION] Sending no-slots notification to user ${requester.id}`);
  
  if (requester.telegramChatId) {
    try {
      await baseSendTelegramMessage(requester.telegramChatId,
        `⚠️ **No Available Time Slots**\n\n` +
        `**Meeting:** ${meetingRequest.title}\n` +
        `**With:** ${meetingRequest.targetEmail}\n` +
        `**Timeframe:** ${meetingRequest.preferredTimeframe}\n\n` +
        `❌ No suitable time slots found in their calendar.\n` +
        `💡 Try extending the timeframe or contact them directly.`
      );
      console.log(`✅ [NOTIFICATION] No-slots notification sent successfully`);
    } catch (error) {
      console.error(`❌ [NOTIFICATION] Failed to send no-slots notification:`, error);
    }
  } else {
    console.log(`⚠️ [NOTIFICATION] No Telegram chat ID for user ${requester.id}`);
  }
}

export { baseSendTelegramMessage as sendTelegramMessage };