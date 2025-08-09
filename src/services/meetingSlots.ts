// ===== FILE 1: services/meetingSlots.ts =====
import { google } from 'googleapis';
import { sendTelegramMessageWithInlineButtons, sendErrorNotification } from './telegramService';
import prisma from '../utils/prisma';
import { getRedisData, setRedisData, deleteRedisData } from '../routes/gmail';

interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  displayText: string;
}

interface SlotData {
  slots: TimeSlot[];
  requesterChatId: string;
  targetEmail: string;
  meetingRequestId: string;
  meetingTitle: string;
  duration: number;
  expiresAt: number;
  slotOfferId: string;
}

// Generate available time slots based on free/busy data
export async function generateAvailableSlots(
  targetEmail: string,
  duration: number,
  timeframe: string = 'this week'
): Promise<TimeSlot[]> {
  try {
    // Get stored tokens from Redis
    const redisKey = `calendar_token:${targetEmail}`;
    const tokenData = await getRedisData(redisKey);
    
    if (!tokenData) {
      throw new Error('Calendar tokens not found');
    }

    // Setup OAuth2 client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Calculate time range based on preferred timeframe
    const now = new Date();
    let startDate = new Date(now);
    let endDate = new Date(now);

    switch (timeframe.toLowerCase()) {
      case 'today':
        endDate.setDate(now.getDate() + 1);
        break;
      case 'tomorrow':
        startDate.setDate(now.getDate() + 1);
        endDate.setDate(now.getDate() + 2);
        break;
      case 'this week':
        endDate.setDate(now.getDate() + 7);
        break;
      case 'next week':
        startDate.setDate(now.getDate() + 7);
        endDate.setDate(now.getDate() + 14);
        break;
      case 'this month':
        endDate.setMonth(now.getMonth() + 1);
        break;
      default:
        endDate.setDate(now.getDate() + 7); // Default to this week
    }

    // Query free/busy information
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: 'UTC',
        items: [{ id: 'primary' }]
      }
    });

    const busyTimes = freeBusyResponse.data.calendars?.primary?.busy || [];
    
    // Generate time slots (business hours: 9 AM - 5 PM, 30-min intervals)
    const slots: TimeSlot[] = [];
    const current = new Date(startDate);

    while (current < endDate) {
      // Skip weekends
      if (current.getDay() === 0 || current.getDay() === 6) {
        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
        continue;
      }

      // Set to business hours start if not already
      if (current.getHours() < 9) {
        current.setHours(9, 0, 0, 0);
      }

      // Skip if past business hours for the day
      if (current.getHours() >= 17) {
        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
        continue;
      }

      const slotStart = new Date(current);
      const slotEnd = new Date(current.getTime() + duration * 60000);

      // Check if slot conflicts with busy times
      const isConflicted = busyTimes.some(busy => {
        const busyStart = new Date(busy.start!);
        const busyEnd = new Date(busy.end!);
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      if (!isConflicted && slotEnd.getHours() <= 17) {
        const slotId = `slot_${slotStart.getTime()}`;
        const displayText = formatSlotDisplay(slotStart, slotEnd);
        
        slots.push({
          id: slotId,
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          displayText
        });
      }

      // Move to next 30-minute interval
      current.setTime(current.getTime() + 30 * 60000);
    }

    return slots.slice(0, 10); // Limit to first 10 slots to avoid too many buttons
    
  } catch (error) {
    console.error('Error generating available slots:', error);
    throw error;
  }
}

// Format slot for display
export function formatSlotDisplay(startTime: Date, endTime: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };

  const start = startTime.toLocaleDateString('en-US', options);
  const endTime12 = endTime.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  });

  return `${start} - ${endTime12}`;
}

// Send available slots as Telegram inline buttons
export async function sendAvailableSlotsToRequester(
  meetingRequestId: string,
  targetEmail: string,
  requesterUser: any,
  timeframe: string = 'this week'
) {
  try {
    console.log(`🎯 [SLOTS] Processing slots for meeting request: ${meetingRequestId}`);

    // Get meeting request with slot offer and access request
    const meetingRequest = await prisma.meetingRequest.findUnique({
      where: { id: meetingRequestId },
      include: {
        accessRequest: {
          select: {
            purpose: true,
            preferredDuration: true
          }
        },
        slotOffer: true
      }
    });

    if (!meetingRequest || !meetingRequest.accessRequest || !meetingRequest.slotOffer) {
      console.log(`❌ [SLOTS] Meeting request, access request, or slot offer not found for: ${meetingRequestId}`);
      return;
    }

    const duration = meetingRequest.accessRequest.preferredDuration || 30;
    const title = meetingRequest.accessRequest.purpose;
    const slotOfferId = meetingRequest.slotOffer.id;

    // Parse offered slots from slotOffer
    let offeredSlots: TimeSlot[] = [];
    try {
      offeredSlots = JSON.parse(meetingRequest.slotOffer.offeredSlots as string);
    } catch (error) {
      console.error(`❌ [SLOTS] Error parsing offered slots for slot offer ${slotOfferId}:`, error);
      throw new Error('Invalid slot data');
    }

    if (offeredSlots.length === 0) {
      if (requesterUser.telegramChatId) {
        await sendErrorNotification(
          requesterUser.telegramChatId,
          `No available slots found for "${title}" with ${targetEmail}.\nPlease request new time slots.`
        );
      }
      console.log(`❌ [SLOTS] No available slots for meeting request: ${meetingRequestId}`);
      return;
    }

    // Store slots in Redis with slotOfferId
    const redisKey = `meeting_slots:${meetingRequestId}`;
    const slotData: SlotData = {
      slots: offeredSlots,
      requesterChatId: requesterUser.telegramChatId,
      targetEmail,
      meetingRequestId,
      meetingTitle: title,
      duration,
      expiresAt: new Date(meetingRequest.slotOffer.expiresAt).getTime(),
      slotOfferId
    };

    await setRedisData(redisKey, slotData, Math.floor((slotData.expiresAt - Date.now()) / 1000));

    // Prepare Telegram buttons
    const buttons = offeredSlots.map((slot, index) => [
      {
        text: slot.displayText,
        callback_data: `book_meeting:${slot.id}:${meetingRequestId}:${index}`
      }
    ]);

    // Send message with buttons
    if (requesterUser.telegramChatId) {
      const message = `📅 *Available Slots for "${title}"*\n\n` +
        `👤 With: ${targetEmail}\n` +
        `⏱️ Duration: ${duration} minutes\n` +
        `⏳ Expires: ${new Date(slotData.expiresAt).toLocaleString()}\n\n` +
        `Please select your preferred time slot:`;

      await sendTelegramMessageWithInlineButtons(
        requesterUser.telegramChatId,
        message,
        buttons
      );
      console.log(`✅ [SLOTS] Sent ${offeredSlots.length} slots to requester`);
    }

  } catch (error) {
    console.error(`❌ [SLOTS] Error sending slots for meeting request ${meetingRequestId}:`, error);
    if (requesterUser?.telegramChatId) {
      await sendErrorNotification(
        requesterUser.telegramChatId,
        'Sorry, there was an error processing your time slots. Please try again later.'
      );
    }
  }
}

// Handle slot booking from Telegram callback
export async function handleSlotBooking(callbackData: string, callbackQueryId: string) {
  try {
    console.log(`🎯 [BOOKING] Processing slot booking: ${callbackData}`);

    const parts = callbackData.split(':');
    if (parts.length !== 4 || parts[0] !== 'book_meeting') {
      throw new Error('Invalid callback data format');
    }

    const [, slotId, meetingRequestId, slotIndexStr] = parts;
    const slotIndex = parseInt(slotIndexStr);

    const redisKey = `meeting_slots:${meetingRequestId}`;
    const slotData: SlotData = await getRedisData(redisKey);
    if (!slotData) throw new Error('Slot data not found or expired');

    const selectedSlot = slotData.slots.find(slot => slot.id === slotId);
    if (!selectedSlot) throw new Error('Selected slot not found');

    if (Date.now() > slotData.expiresAt) {
      await deleteRedisData(redisKey);
      throw new Error('Slot selection has expired');
    }

    const meetingEvent = await createCalendarMeeting(slotData, selectedSlot);

    const requesterUser = await prisma.user.findFirst({
      where: { telegramChatId: slotData.requesterChatId },
    });

    if (!requesterUser) throw new Error('Requester user not found');

    // Create Meeting and link to SlotOffer and MeetingRequest
    const createdMeeting = await prisma.meeting.create({
      data: {
        title: slotData.meetingTitle,
        description: 'Meeting booked via scheduling system',
        startTime: new Date(selectedSlot.startTime),
        endTime: new Date(selectedSlot.endTime),
        duration: slotData.duration,
        organizer: {
          connect: { id: requesterUser.id },
        },
        meetingLink: meetingEvent.hangoutLink ?? meetingEvent.htmlLink,
        googleEventId: meetingEvent.id,
        slotOffer: {
          connect: { id: slotData.slotOfferId },
        },
      },
    });

    // Update SlotOffer with selected slot and status
    await prisma.slotOffer.update({
      where: { id: slotData.slotOfferId },
      data: {
        selectedSlotIndex: slotIndex,
        status: 'booked',
        meeting:{
            connect:{id:createdMeeting.id}
        }
      },
    });

    // Update MeetingRequest to link final meeting
    await prisma.meetingRequest.update({
      where: { id: meetingRequestId },
      data: {
        meetingId: createdMeeting.id,
      },
    });

    // Create attendees
    await prisma.meetingAttendee.createMany({
      data: [
        {
          meetingId: createdMeeting.id,
          userId: requesterUser.id,
          status: 'accepted',
        },
        // You can optionally add a host/placeholder User for the targetEmail if needed
      ],
      skipDuplicates: true,
    });

    await deleteRedisData(redisKey);

    console.log(`✅ [BOOKING] Successfully booked meeting ${createdMeeting.id}`);

    return {
      success: true,
      message: 'Meeting booked successfully!',
      meetingEvent,
    };

  } catch (error) {
    console.error(`❌ [BOOKING] Error booking slot:`, error);
    throw error;
  }
}

// Create actual calendar meeting
async function createCalendarMeeting(slotData: SlotData, selectedSlot: TimeSlot) {
  try {
    // Get stored tokens from Redis
    const redisKey = `calendar_token:${slotData.targetEmail}`;
    const tokenData = await getRedisData(redisKey);
    
    if (!tokenData) {
      throw new Error('Calendar tokens not found');
    }

    // Setup OAuth2 client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get requester user details
    const requesterUser = await prisma.user.findFirst({
      where: { telegramChatId: slotData.requesterChatId },
      select: { email: true, name: true }
    });

    if (!requesterUser) {
      throw new Error('Requester user not found');
    }

    // Create calendar event
    const event = {
      summary: slotData.meetingTitle,
      description: `Meeting booked via scheduling system`,
      start: {
        dateTime: selectedSlot.startTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: selectedSlot.endTime,
        timeZone: 'UTC',
      },
      attendees: [
        { email: slotData.targetEmail, displayName: 'Host' },
        { email: requesterUser.email, displayName: requesterUser.name || 'Guest' }
      ],
      reminders: {
        useDefault: true,
      },
    };

    const createdEvent = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'all',
    });

    console.log(`✅ [CALENDAR] Created event: ${createdEvent.data.id}`);
    return createdEvent.data;

  } catch (error) {
    console.error('❌ [CALENDAR] Error creating calendar meeting:', error);
    throw error;
  }
}

// Process all approved meeting requests by sending slots
export async function processApprovedMeetingRequests(accessRequest: any, targetEmail: string) {
  console.log(`🚀 [SLOTS] Processing ${accessRequest.meetingRequests.length} meeting requests...`);
  
  for (const meetingRequest of accessRequest.meetingRequests) {
    try {
      await sendAvailableSlotsToRequester(
        meetingRequest.id,
        targetEmail,
        accessRequest.requesterUser
      );
    } catch (error) {
      console.error(`❌ [SLOTS] Error processing meeting request ${meetingRequest.id}:`, error);
    }
  }
}