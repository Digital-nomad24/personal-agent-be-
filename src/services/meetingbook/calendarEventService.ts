import { google } from 'googleapis';
import { getRedisData } from '../../routes/gmail';
import { createCalendarWatchChannel } from '../../utils/approve-callback.utils';
import prisma from '../../utils/prisma';

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

    // Save the event to CalendarEvent table
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