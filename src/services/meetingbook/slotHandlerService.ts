// handlers/slotSelectionHandler.ts
import axios from 'axios';
import { parseTimeframe, checkExternalAvailability, findAvailableSlots } from '../../utils/approve-callback.utils';
import { sendTelegramSlotSelection } from '../../utils/meetingUtils/telegramUtils';
import prisma from '../../utils/prisma';
import { createCalendarEvent } from './calendarEventService';
import { Prisma } from '@prisma/client';

export async function handleSlotSelection(callbackData: string, chatId: string, messageId: string) {
  console.log(`🎯 [CALLBACK] Handling: ${callbackData}`);

  try {
    const [action, ...params] = callbackData.split(':');

    if (action === 'select_slot') {
      const [slotOfferId, slotIndex] = params;
      await processSlotSelection(slotOfferId, parseInt(slotIndex), chatId, messageId);
    } 
    else if (action === 'cancel_slots') {
      await processCancelSlots(params[0], chatId, messageId);
    }
    else if (action === 'refresh_slots') {
      await processRefreshSlots(params[0], chatId, messageId);
    }

  } catch (error: any) {
    console.error(`❌ [CALLBACK ERROR] Error handling selection:`, error.message);

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
        meetingRequest: {
          include: {
            requesterUser: true
          }
        }
      }
    });

    if (!slotOffer || slotOffer.status !== 'active') {
      throw new Error('Slot offer not found or no longer active');
    }

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

    // Prepare meeting data using only fields from accessRequest since meetingRequest doesn't have them
    const meetingData = {
      id: slotOffer.meetingRequest?.id,
      title: slotOffer.accessRequest.purpose, // Using purpose as title
      description: slotOffer.accessRequest.purpose,
      duration: slotOffer.accessRequest.preferredDuration || 30,
      purpose: slotOffer.accessRequest.purpose,
      location: slotOffer.accessRequest.location,
      targetEmail: slotOffer.accessRequest.targetEmail
    };
    console.log(`📋 [PROCESS SELECTION] Meeting data prepared:`, meetingData);

    // Create calendar event
    console.log(`🎫 [PROCESS SELECTION] Creating calendar event`);
    const bookingResult = await createCalendarEvent(
      meetingData,
      selectedSlot,
      slotOffer.accessRequest.targetEmail,
      slotOffer.accessRequest.requesterUserId
    );

    if (bookingResult.success) {
      // Create Meeting record
      console.log(`💾 [PROCESS SELECTION] Creating meeting record`);
const meeting = await prisma.meeting.create({
  data: {
    title: meetingData.title,
    description: meetingData.description,
    startTime: new Date(selectedSlot.start),
    endTime: new Date(selectedSlot.end),
    duration: meetingData.duration,
    location: meetingData.location,
    status: 'confirmed',
    organizer: {
      connect: { id: slotOffer.accessRequest.requesterUserId }
    },
    sourceType: 'manual',
    externalAttendeeEmail: slotOffer.accessRequest.targetEmail,
    googleEventId: bookingResult.eventId || null,
    slotOffer: slotOfferId ? { connect: { id: slotOfferId } } : undefined
  }
});

      // Link meeting to MeetingRequest if exists
      // Link meeting to MeetingRequest if exists
if (slotOffer.meetingRequest) {
  // Create base update data
  const updateData: Prisma.MeetingRequestUncheckedUpdateInput = {
    meetingId: meeting.id
  };

  // Only add accessRequest if accessRequestId exists
  if (slotOffer.accessRequestId) {
    updateData.accessRequestId = slotOffer.accessRequestId;
  }

  await prisma.meetingRequest.update({
    where: { id: slotOffer.meetingRequest.id },
    data: updateData
  });
}

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
    await prisma.slotOffer.update({
      where: { id: slotOfferId },
      data: { status: 'cancelled' }
    });

    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ **Meeting Request Cancelled**\n\nYou can create a new meeting request anytime using \`/meet\`.`,
        parse_mode: 'Markdown'
      }
    );
    console.log(`✅ [CANCEL SLOTS] Successfully cancelled slot offer: ${slotOfferId}`);
  } catch (error: any) {
    console.error('❌ [CANCEL SLOTS ERROR] Error cancelling slots:', error);
  }
}

async function processRefreshSlots(slotOfferId: string, chatId: string, messageId: string) {
  console.log(`🔄 [REFRESH SLOTS] Starting refresh for slot offer: ${slotOfferId}`);

  try {
    const slotOffer = await prisma.slotOffer.findUnique({
      where: { id: slotOfferId },
      include: {
        accessRequest: {
          include: {
            requesterUser: true
          }
        },
        meetingRequest: true
      }
    });

    if (!slotOffer) {
      throw new Error('Slot offer not found');
    }

    if (slotOffer.status !== 'active') {
      throw new Error('Slot offer is no longer active');
    }

    console.log(`✅ [REFRESH SLOTS] Found slot offer for refresh`);

    const meetingData = {
      id: slotOffer.meetingRequest?.id,
      title: slotOffer.accessRequest.purpose, // Using purpose as title
      description: slotOffer.accessRequest.purpose,
      duration: slotOffer.accessRequest.preferredDuration || 30,
      preferredTimeframe: slotOffer.accessRequest.preferredTimeframe || 'this week',
      targetEmail: slotOffer.accessRequest.targetEmail,
      purpose: slotOffer.accessRequest.purpose,
      location: slotOffer.accessRequest.location,
    };

    const { startDate, endDate } = parseTimeframe(meetingData.preferredTimeframe);

    const availabilityResult = await checkExternalAvailability(
      slotOffer.accessRequest.requesterUserId,
      slotOffer.accessRequest.targetEmail,
      startDate,
      endDate
    );

    if (!availabilityResult.success) {
      throw new Error(`Failed to get availability: ${availabilityResult.error}`);
    }

    const availableSlots = findAvailableSlots(
      availabilityResult.busySlots,
      startDate,
      endDate,
      meetingData.duration
    );

    if (availableSlots.length === 0) {
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
        {
          chat_id: chatId,
          message_id: messageId,
          text: `❌ **No Available Slots**\n\n` +
                `📝 **Meeting:** ${meetingData.title}\n` +
                `👤 **With:** ${slotOffer.accessRequest.targetEmail}\n` +
                `⏱️ **Duration:** ${meetingData.duration} minutes\n\n` +
                `Unfortunately, no available slots were found for the requested timeframe.\n\n` +
                `💡 Try contacting them directly or extending the timeframe.`,
          parse_mode: 'Markdown'
        }
      );
      return;
    }

    await prisma.slotOffer.update({
      where: { id: slotOfferId },
      data: {
        offeredSlots: availableSlots,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    console.log(`✅ [REFRESH SLOTS] Updated slot offer with ${availableSlots.length} new slots`);

    await sendTelegramSlotSelection(
      chatId,
      meetingData,
      slotOffer.accessRequest.targetEmail,
      availableSlots,
      slotOfferId,
      messageId,
      true
    );

    console.log(`✅ [REFRESH SLOTS] Successfully refreshed and updated Telegram message`);

  } catch (error: any) {
    console.error('❌ [REFRESH SLOTS ERROR] Error refreshing slots:', error);

    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ **Refresh Failed**\n\n**Error:** ${error.message}\n\nPlease try again or create a new meeting request.`,
        parse_mode: 'Markdown'
      }
    );
  }
}