import axios from "axios";
import { google } from "googleapis";
import { generateToken } from "../routes/auth";
import { sendTelegramMessage } from "../services/telegramService";
import prisma from "./prisma";
import { getRedisData } from "../routes/gmail";

export async function processIndividualMeetingRequest(
  meetingRequestId: string,
  targetEmail: string,
  requester: { id: string; name: string | null; email: string; telegramChatId: string | null },
  accessRequest: { 
    id: string;
    status: string;
    purpose: string; 
    preferredDuration: number | null; 
    preferredTimeframe: string | null; 
    location: string | null; 
    targetEmail: string;
  }
) {
  console.log(`\n🔄 [MEETING STEP 1] ===== Processing meeting request ${meetingRequestId} =====`);
  console.log(`🔄 [MEETING DEBUG] Target email: ${targetEmail}`);
  console.log(`🔄 [MEETING DEBUG] Requester:`, {
    id: requester.id,
    name: requester.name,
    email: requester.email,
    hasTelegramChatId: !!requester.telegramChatId
  });
  console.log(`🔄 [MEETING DEBUG] Access request:`, {
    id: accessRequest.id,
    status: accessRequest.status,
    purpose: accessRequest.purpose,
    duration: accessRequest.preferredDuration,
    timeframe: accessRequest.preferredTimeframe
  });

  try {
    // Verify the meeting request exists
    console.log(`🔍 [MEETING STEP 2] Fetching meeting request from database`);
    const meetingRequest = await prisma.meetingRequest.findUnique({
      where: { id: meetingRequestId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        slotOfferId: true,
        requesterUserId: true,
        accessRequestId: true,
        meetingId: true
      }
    });

    if (!meetingRequest) {
      console.log(`❌ [MEETING STEP 2] Meeting request ${meetingRequestId} not found, skipping...`);
      return;
    }

    console.log(`✅ [MEETING STEP 2] Meeting request found:`, {
      id: meetingRequest.id,
      accessRequestId: meetingRequest.accessRequestId,
      requesterUserId: meetingRequest.requesterUserId,
      hasExistingMeeting: !!meetingRequest.meetingId
    });

    // Use the passed-in accessRequest (already approved)
    console.log(`✅ [MEETING STEP 3] Using passed-in access request (status: ${accessRequest.status})`);

    // Create meeting data object from accessRequest
    console.log(`📋 [MEETING STEP 4] Creating meeting data object`);
    const meetingData = {
      id: meetingRequestId,
      title: accessRequest.purpose,
      description: accessRequest.purpose,
      duration: accessRequest.preferredDuration || 30,
      preferredTimeframe: accessRequest.preferredTimeframe || 'this week',
      targetEmail: accessRequest.targetEmail,
      purpose: accessRequest.purpose,
      location: accessRequest.location,
      meetingLink: null,
    };

    console.log(`✅ [MEETING STEP 4] Meeting data created:`, meetingData);

    // Step 1: Parse timeframe and get date range
    console.log(`📅 [MEETING STEP 5] Parsing timeframe: ${meetingData.preferredTimeframe}`);
    const { startDate, endDate } = parseTimeframe(meetingData.preferredTimeframe);
    
    console.log(`✅ [MEETING STEP 5] Date range determined:`, {
      startDate,
      endDate,
      timeframe: meetingData.preferredTimeframe
    });

    // Step 2: Check external user's availability
    console.log(`🔍 [MEETING STEP 6] Checking external availability for ${targetEmail}`);
    const availabilityResult = await checkExternalAvailability(
      requester.id,
      targetEmail,
      startDate,
      endDate
    );

    console.log(`📊 [MEETING STEP 6] Availability result:`, {
      success: availabilityResult.success,
      busySlotsCount: availabilityResult.success ? availabilityResult.busySlots?.length : 0,
      error: availabilityResult.success ? null : availabilityResult.error
    });

    if (!availabilityResult.success) {
      console.log(`❌ [MEETING STEP 6] Failed to get availability: ${availabilityResult.error}`);
      throw new Error(`Failed to get availability: ${availabilityResult.error}`);
    }

    // Step 3: Find suitable time slots
    console.log(`🎯 [MEETING STEP 7] Finding available slots`);
    const availableSlots = findAvailableSlots(
      availabilityResult.busySlots,
      startDate,
      endDate,
      meetingData.duration
    );

    console.log(`📅 [MEETING STEP 7] Available slots found:`, {
      count: availableSlots.length,
      slots: availableSlots.map(slot => ({
        start: slot.start,
        end: slot.end
      }))
    });

    if (availableSlots.length === 0) {
      console.log(`❌ [MEETING STEP 7] No slots available - notifying user`);
      await notifyNoAvailableSlots(meetingData, requester);
      return;
    }

    // Step 4: Auto-book the first available slot
    const selectedSlot = availableSlots[0];
    console.log(`📅 [MEETING STEP 8] Selected slot:`, {
      start: selectedSlot.start,
      end: selectedSlot.end,
      duration: meetingData.duration
    });

    console.log(`🎫 [MEETING STEP 9] Creating calendar event`);
    const bookingResult = await createCalendarEvent(meetingData, selectedSlot, targetEmail, requester.id);

    console.log(`📊 [MEETING STEP 9] Calendar event result:`, {
      success: bookingResult.success,
      eventId: bookingResult.success ? bookingResult.eventId : null,
      error: bookingResult.success ? null : bookingResult.error
    });

    if (bookingResult.success) {
      // Step 5: Create a Meeting record and link it to MeetingRequest
      console.log(`💾 [MEETING STEP 10] Creating meeting record in database`);
      const meeting = await prisma.meeting.create({
        data: {
          title: meetingData.title,
          description: meetingData.description,
          startTime: new Date(selectedSlot.start),
          endTime: new Date(selectedSlot.end),
          duration: meetingData.duration,
          location: meetingData.location,
          meetingLink: null,
          status: 'confirmed',
          organizerId: requester.id,
          sourceType: 'manual',
          externalAttendeeEmail: targetEmail,
          externalAttendeeName: null,
          googleEventId: bookingResult.eventId || null,
        }
      });

      console.log(`✅ [MEETING STEP 10] Meeting created:`, {
        id: meeting.id,
        title: meeting.title,
        startTime: meeting.startTime,
        googleEventId: meeting.googleEventId
      });

      // Step 6: Update MeetingRequest to link to the created meeting
      console.log(`🔗 [MEETING STEP 11] Linking meeting request to meeting`);
      await prisma.meetingRequest.update({
        where: { id: meetingRequestId },
        data: {
          meetingId: meeting.id
        }
      });

      console.log(`✅ [MEETING STEP 11] Meeting request updated with meeting ID: ${meeting.id}`);

      // Step 7: Notify user via Telegram
      console.log(`📱 [MEETING STEP 12] Sending notification to user`);
      await notifyMeetingScheduled(meetingData, selectedSlot, requester);

      console.log(`🎉 [MEETING SUCCESS] Successfully scheduled meeting ${meetingRequestId}`);
    } else {
      console.log(`❌ [MEETING STEP 9] Calendar event creation failed: ${bookingResult.error}`);
      throw new Error(`Failed to create calendar event: ${bookingResult.error}`);
    }

  } catch (error: any) {
    console.error(`❌ [MEETING ERROR] Failed to process meeting request ${meetingRequestId}:`, {
      error: error.message,
      stack: error.stack
    });
    
    // Notify user of failure
    console.log(`📱 [MEETING ERROR] Sending failure notification`);
    if (requester.telegramChatId) {
      await sendTelegramMessage(requester.telegramChatId,
        `❌ **Meeting Scheduling Failed**\n\n` +
        `**With:** ${targetEmail}\n` +
        `**Error:** ${error.message}\n\n` +
        `Please try scheduling manually or contact them directly.`
      ).catch(err => {
        console.error(`❌ [MEETING ERROR] Failed to send Telegram notification:`, err);
      });
    } else {
      console.log(`⚠️ [MEETING ERROR] No Telegram chat ID for user ${requester.id}`);
    }
  }
}

// Helper function to check external availability (calls your existing route)
export async function checkExternalAvailability(userId: string, targetEmail: string, startDate: string, endDate: string) {
  console.log(`🔍 [AVAILABILITY STEP 1] Starting availability check`);
  console.log(`🔍 [AVAILABILITY DEBUG] Params:`, { userId, targetEmail, startDate, endDate });
  
  try {
    console.log(`🎫 [AVAILABILITY STEP 2] Generating token for user ${userId}`);
    const token = generateToken(userId);
    console.log(`✅ [AVAILABILITY STEP 2] Token generated successfully`);
    
    console.log(`📡 [AVAILABILITY STEP 3] Making API call to external-availability`);
    const response = await axios.post(`http://localhost:8000/api/v1/gmail/external-availability`, {
      targetEmail,
      startDate,
      endDate
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 30000
    });

    console.log(`✅ [AVAILABILITY STEP 3] API call successful:`, {
      status: response.status,
      busySlotsCount: response.data.busySlots?.length || 0,
      hasUserInfo: !!response.data.userInfo
    });

    return {
      success: true,
      busySlots: response.data.busySlots,
      userInfo: response.data.userInfo
    };
  } catch (error: any) {
    console.error('❌ [AVAILABILITY ERROR] Error checking external availability:', {
      message: error.message,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    });
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

// Helper function to parse timeframe into actual dates
export function parseTimeframe(timeframe: string): { startDate: string; endDate: string } {
  console.log(`📅 [TIMEFRAME] Parsing: ${timeframe}`);
  
  const now = new Date();
  const startOfWorkingDay = 9; // 9 AM
  const endOfWorkingDay = 17; // 5 PM
  
  let result;
  
  switch (timeframe.toLowerCase()) {
    case 'today':
      result = {
        startDate: new Date(now.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(now.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
    
    case 'tomorrow':
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      result = {
        startDate: new Date(tomorrow.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(tomorrow.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
    
    case 'this week':
    default:
      // Next 5 working days
      const endDate = new Date(now);
      endDate.setDate(now.getDate() + 5);
      result = {
        startDate: new Date(now.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(endDate.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
  }
  
  console.log(`✅ [TIMEFRAME] Parsed result:`, result);
  return result;
}

// Helper function to find available time slots
export function findAvailableSlots(busySlots: any[], startDate: string, endDate: string, durationMinutes: number) {
  console.log(`🎯 [SLOTS] Finding available slots`);
  console.log(`🎯 [SLOTS DEBUG] Input:`, {
    busySlotsCount: busySlots.length,
    startDate,
    endDate,
    durationMinutes
  });
  
  const slots: { start: string; end: string }[] = [];
  const duration = durationMinutes * 60 * 1000; // Convert to milliseconds
  const slotGap = 15 * 60 * 1000; // 15-minute gaps between meetings
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  console.log(`🎯 [SLOTS] Time range:`, {
    start: start.toISOString(),
    end: end.toISOString(),
    durationMs: duration
  });
  
  // Generate potential slots every 30 minutes during working hours
  let currentTime = new Date(start);
  let checkedSlots = 0;
  
  while (currentTime < end) {
    const slotEnd = new Date(currentTime.getTime() + duration);
    checkedSlots++;
    
    // Check if this slot conflicts with any busy time
    const hasConflict = busySlots.some(busy => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      
      return (currentTime < busyEnd && slotEnd > busyStart);
    });
    
    if (!hasConflict && slotEnd <= end) {
      slots.push({
        start: currentTime.toISOString(),
        end: slotEnd.toISOString()
      });
      console.log(`✅ [SLOTS] Found available slot ${slots.length}: ${currentTime.toISOString()} - ${slotEnd.toISOString()}`);
    } else if (hasConflict) {
      console.log(`❌ [SLOTS] Slot ${checkedSlots} has conflict: ${currentTime.toISOString()} - ${slotEnd.toISOString()}`);
    }
    
    // Move to next potential slot (30-minute intervals)
    currentTime = new Date(currentTime.getTime() + 30 * 60 * 1000);
  }
  
  const result = slots.slice(0, 5); // Return max 5 slots
  console.log(`🎯 [SLOTS] Final result: ${result.length} available slots out of ${checkedSlots} checked`);
  return result;
}

// ✅ UPDATED: Helper function to create calendar event with actual Google Calendar integration
export async function createCalendarEvent(
  meetingRequest: any, 
  timeSlot: { start: string; end: string }, 
  targetEmail: string, 
  requesterUserId: string
) {
  console.log(`📅 [CALENDAR STEP 1] Starting calendar event creation`);
  console.log(`📅 [CALENDAR DEBUG] Input:`, {
    title: meetingRequest.title,
    targetEmail,
    requesterUserId,
    timeSlot
  });

  try {
    // Get tokens from Redis for the target user
    console.log(`🔍 [CALENDAR STEP 2] Getting tokens from Redis`);
    const redisKey = `calendar_token:${targetEmail}`;
    const tokenData = await getRedisData(redisKey);
    
    if (!tokenData) {
      console.log(`❌ [CALENDAR STEP 2] Calendar tokens not found in Redis for ${targetEmail}`);
      throw new Error('Calendar tokens not found in Redis');
    }

    console.log(`✅ [CALENDAR STEP 2] Tokens found in Redis:`, {
      hasAccessToken: !!tokenData.accessToken,
      hasRefreshToken: !!tokenData.refreshToken,
      expiresAt: tokenData.expiresAt
    });

    // Set up OAuth2 client with tokens
    console.log(`🔐 [CALENDAR STEP 3] Setting up OAuth2 client`);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_APPROVAL_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
    });

    console.log(`✅ [CALENDAR STEP 3] OAuth2 client configured`);

    // Initialize Calendar API
    console.log(`📅 [CALENDAR STEP 4] Initializing Calendar API`);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get requester info for the event
    console.log(`👤 [CALENDAR STEP 5] Getting requester info`);
    const requester = await prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { name: true, email: true }
    });

    console.log(`✅ [CALENDAR STEP 5] Requester info:`, {
      name: requester?.name,
      email: requester?.email
    });

    // Create the calendar event
    console.log(`📝 [CALENDAR STEP 6] Creating calendar event`);
    const eventResource = {
      summary: meetingRequest.title,
      description: meetingRequest.description || meetingRequest.purpose,
      start: {
        dateTime: timeSlot.start,
        timeZone: 'UTC',
      },
      end: {
        dateTime: timeSlot.end,
        timeZone: 'UTC',
      },
      attendees: [
        { email: targetEmail },
        { email: requester?.email || '' }
      ],
      location: meetingRequest.location || undefined,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 1440 }, // 24 hours before
          { method: 'popup', minutes: 15 }     // 15 minutes before
        ],
      },
    };

    console.log(`📝 [CALENDAR DEBUG] Event resource:`, eventResource);

    const eventResponse = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventResource,
      sendUpdates: 'all', // Send email invitations to all attendees
    });

    const googleEventId = eventResponse.data.id;
    console.log(`✅ [CALENDAR STEP 6] Calendar event created with ID: ${googleEventId}`);

    // Save the event to CalendarEvent table (following your pattern)
    console.log(`💾 [CALENDAR STEP 7] Saving event to database`);
    try {
      await prisma.calendarEvent.create({
        data: {
          userId: requesterUserId,
          title: meetingRequest.title,
          description: meetingRequest.description || meetingRequest.purpose,
          startTime: new Date(timeSlot.start),
          endTime: new Date(timeSlot.end),
          isAllDay: false,
          googleEventId: googleEventId || null,
          status: 'confirmed'
        }
      });
      console.log(`✅ [CALENDAR STEP 7] Saved calendar event to database`);
    } catch (dbError) {
      console.error('❌ [CALENDAR STEP 7] Error saving calendar event to database:', dbError);
      // Don't fail the entire process if DB save fails
    }

    // Create watch channel for calendar changes
    console.log(`👁️ [CALENDAR STEP 8] Creating watch channel`);
    await createCalendarWatchChannel(targetEmail, oauth2Client);

    console.log(`🎉 [CALENDAR SUCCESS] Calendar event creation completed`);
    return {
      success: true,
      eventId: googleEventId
    };

  } catch (error: any) {
    console.error('❌ [CALENDAR ERROR] Error creating calendar event:', {
      message: error.message,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
}

// ✅ NEW: Helper function to create calendar watch channel
export async function createCalendarWatchChannel(userEmail: string, oauth2Client: any) {
  console.log(`👁️ [WATCH STEP 1] Creating calendar watch channel for ${userEmail}`);
  
  try {
    // Find user by email to get userId
    console.log(`🔍 [WATCH STEP 2] Finding user by email`);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true }
    });

    if (!user) {
      console.error(`❌ [WATCH STEP 2] User not found for email: ${userEmail}`);
      return;
    }

    console.log(`✅ [WATCH STEP 2] User found: ${user.id}`);

    const userId = user.id;
    const channelId = `calendar_watch_${userId}_${Date.now()}`;
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/v1/gmail/calendar-webhook`;

    console.log(`📝 [WATCH STEP 3] Watch channel details:`, {
      channelId,
      webhookUrl,
      userId
    });

    // Initialize Calendar API
    console.log(`📅 [WATCH STEP 4] Initializing Calendar API for watch`);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Create watch channel
    console.log(`🔔 [WATCH STEP 5] Creating watch channel`);
    const watchRes = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: userId, 
      },
    });

    console.log('✅ [WATCH STEP 5] Watch channel created:', {
      channelId,
      kind: watchRes.data.kind,
      resourceUri: watchRes.data.resourceUri,
    });

    const resourceId = watchRes.data.resourceId!;
    const expirationMillis = parseInt(watchRes.data.expiration || '0');
    const expirationTime = new Date(expirationMillis);

    console.log('📊 [WATCH STEP 5] Watch channel details:', {
      channelId,
      resourceId,
      expiration: expirationTime
    });

    // Save channel info to CalendarChannel table
    console.log(`💾 [WATCH STEP 6] Saving watch channel to database`);
    await prisma.calendarChannel.create({
      data: {
        userId,
        channelId,
        resourceId,
        expiration: expirationTime,
        token: userId // optional, if you want to verify in webhook
      }
    });

    console.log(`✅ [WATCH STEP 6] Calendar watch channel saved for user ${userId}`);

  } catch (error: any) {
    console.error('❌ [WATCH ERROR] Error creating calendar watch channel:', {
      message: error.message,
      stack: error.stack
    });
    // Don't fail the main process if watch channel creation fails
  }
}

// Helper function to notify when no slots are available
export async function notifyNoAvailableSlots(meetingRequest: any, requester: any) {
  console.log(`📱 [NOTIFICATION] Sending no-slots notification to user ${requester.id}`);
  
  if (requester.telegramChatId) {
    try {
      await sendTelegramMessage(requester.telegramChatId,
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

// Helper function to notify successful scheduling
export async function notifyMeetingScheduled(meetingRequest: any, timeSlot: any, requester: any) {
  console.log(`📱 [NOTIFICATION] Sending success notification to user ${requester.id}`);
  
  if (requester.telegramChatId) {
    try {
      const startTime = new Date(timeSlot.start).toLocaleString();
      const endTime = new Date(timeSlot.end).toLocaleString();
      
      await sendTelegramMessage(requester.telegramChatId,
        `🎉 **Meeting Scheduled Successfully!**\n\n` +
        `📝 **Title:** ${meetingRequest.title}\n` +
        `👤 **With:** ${meetingRequest.targetEmail}\n` +
        `📅 **Date & Time:** ${startTime}\n` +
        `⏱️ **Duration:** ${meetingRequest.duration} minutes\n` +
        `🎯 **Purpose:** ${meetingRequest.purpose || 'Not specified'}\n\n` +
        `✅ Calendar invites have been sent to both parties!`
      );
      console.log(`✅ [NOTIFICATION] Success notification sent successfully`);
    } catch (error) {
      console.error(`❌ [NOTIFICATION] Failed to send success notification:`, error);
    }
  } else {
    console.log(`⚠️ [NOTIFICATION] No Telegram chat ID for user ${requester.id}`);
  }
}