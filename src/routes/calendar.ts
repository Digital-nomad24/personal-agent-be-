// src/routes/calendarRouter.ts

import { Router, Request, Response } from 'express';
import dotenv from 'dotenv';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth';
import { google } from 'googleapis';
import googleRouter, { getValidAccessToken } from './google';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
dotenv.config();

const calendarRouter = Router();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error("Missing Google OAuth environment variables");
  process.exit(1);
}

async function getGoogleCalendarClient(userId: string) {
  const accessToken = await getValidAccessToken(userId);
  
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

function getCurrentMonthRange() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  
  return {
    start: startOfMonth,
    end: endOfMonth
  };
}

calendarRouter.post('/sync-calendar', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if(!userId){
      throw new Error()
    }
    const calendar = await getGoogleCalendarClient(userId);
    
    // Get current month range
    const { start, end } = getCurrentMonthRange();
    
    console.log(`Syncing calendar for user ${userId} from ${start.toISOString()} to ${end.toISOString()}`);
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500 
    });

    const events = response.data.items || [];
    console.log(`Fetched ${events.length} events from Google Calendar`);

    await prisma.calendarEvent.deleteMany({
      where: {
        userId,
        startTime: {
          gte: start,
          lte: end
        }
      }
    });

    let syncedCount = 0;
    for (const event of events) {
      if (event.start && event.end) {
        try {
          await prisma.calendarEvent.create({
            data: {
              userId,
              title: event.summary! ,
              description: event.description || null,
              startTime: new Date(event.start.dateTime || event.start.date!),
              endTime: new Date(event.end.dateTime || event.end.date!),
              isAllDay: !event.start.dateTime,
              googleEventId: event.id || null,
              status: event.status === 'confirmed' ? 'confirmed' : 
                     event.status === 'tentative' ? 'tentative' : 'cancelled'
            }
          });
          syncedCount++;
        } catch (error) {
          console.error('Error creating calendar event:', error);
        }
      }
    }

    // Update user's last sync time
    await prisma.user.update({
      where: { id: userId },
      data: { lastCalendarSync: new Date() }
    });

    res.json({ 
      message: 'Calendar synced successfully for current month',
      period: `${start.toDateString()} to ${end.toDateString()}`,
      totalFetched: events.length,
      syncedCount,
      lastSync: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Calendar sync error:', error.message);
    
    if (error.message.includes('User not connected to Google Calendar')) {
      return res.status(401).json({ message: 'Calendar not connected' });
    }
    
    if (error.message.includes('Failed to refresh token')) {
      return res.status(401).json({ message: 'Calendar authentication expired' });
    }
    
    res.status(500).json({ message: 'Failed to sync calendar' });
  }
});

calendarRouter.post('/add-event', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    
    const {
      title,
      description,
      startTime,
      endTime,
      location,
      groupId,
      attendees, // array of emails
      conference
    } = req.body;

    if (!title || !startTime || !endTime || !groupId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const calendar = await getGoogleCalendarClient(userId);

    const eventData: any = {
      summary: title,
      description,
      start: { dateTime: startTime, timeZone: 'UTC' },
      end: { dateTime: endTime, timeZone: 'UTC' },
      location,
      attendees: attendees?.map((email: string) => ({ email })),
    };

    if (conference) {
      eventData.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        }
      };
    }

    const calendarRes = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventData,
      conferenceDataVersion: conference ? 1 : undefined,
      sendUpdates: 'all'
    });

    const googleEvent = calendarRes.data;

    // Save in Meeting model
    const meeting = await prisma.meeting.create({
      data: {
        title,
        description,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration:
          (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60),
        groupId,
        organizerId: userId,
        location,
        meetingLink: googleEvent?.hangoutLink || null,
        googleEventId: googleEvent?.id || null,
        status: 'confirmed',
      }
    });

    res.status(201).json({
      message: 'Meeting created and pushed to Google Calendar',
      eventId: googleEvent.id,
      meeting,
      eventHtmlLink: googleEvent.htmlLink,
    });
  } catch (error: any) {
    console.error('Error pushing meeting to calendar:', error.message);
    res.status(500).json({ message: 'Could not create meeting' });
  }
});

calendarRouter.post('/share-link', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;
    
    const {
      expiresInDays = 2,
      availableDays = 7, // how many future days user wants to open
      slotDuration = 30, // in minutes
      bufferBetween = 0,
      earliestHour = 9,
      latestHour = 17,
      timezone = 'UTC',
      allowWeekends = false,
      allowBookingEdit = true
    } = req.body;

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const availableEnd = new Date(now.getTime() + availableDays * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const shareLink = await prisma.calendarShareLink.create({
      data: {
        userId,
        token,
        expiresAt,
        availableStart: now,
        availableEnd,
        slotDuration,
        bufferBetween,
        earliestHour,
        latestHour,
        timezone,
        allowWeekends,
        allowBookingEdit,
        isActive: true
      }
    });

    res.status(201).json({
      url: `${process.env.CLIENT_URL}/calendar/share/${token}`,
      expiresAt,
      preferences: {
        availableStart: now,
        availableEnd,
        slotDuration,
        bufferBetween,
        earliestHour,
        latestHour,
        timezone,
        allowWeekends
      }
    });
  } catch (err: any) {
    console.error('❌ Error creating share link:', err.message);
    res.status(500).json({ message: 'Could not generate share link' });
  }
});
calendarRouter.get('/share/:token/freebusy', async (req, res) => {
  const { token } = req.params;

  const link = await prisma.calendarShareLink.findUnique({
    where: { token },
    include: { user: true }
  });

  if (!link || new Date() > link.expiresAt || !link.isActive) {
    return res.status(410).json({ message: 'Link expired, inactive, or invalid.' });
  }

  // Token refresh logic (get valid Google access token)
  const accessToken = await getValidAccessToken(link.user.id);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ access_token: accessToken });

  // Use link preferences instead of generic 7 days
  const timeMin = link.availableStart;
  const timeMax = link.availableEnd;

  const freeBusyRes = await google
    .calendar({ version: 'v3', auth: oauth2Client })
    .freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }]
      }
    });

  const busyBlocks = freeBusyRes.data.calendars?.primary?.busy || [];

  res.status(200).json({
    busy: busyBlocks,
    timeMin,
    timeMax,

    // Send custom preferences to frontend so the UI can render accordingly
    preferences: {
      slotDuration: link.slotDuration,
      bufferBetween: link.bufferBetween,
      earliestHour: link.earliestHour,
      latestHour: link.latestHour,
      timezone: link.timezone,
      allowWeekends: link.allowWeekends
    }
  });
});
calendarRouter.post('/share/:token/book',authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const visitor = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    name: true,
    email: true
  }
});

if (!visitor) {
  return res.status(404).json({ message: 'Authenticated user not found' });
}

const visitorName = visitor.name;
const visitorEmail = visitor.email;
console.log("^^^^^^^^^^^^^^^^^^^^^^^^^^",visitorName)
    console.log("REACHED TO THE BOOKING ENDPOINT")
    const { token } = req.params;
    const { startTime, endTime,  } = req.body;

    // 1. Basic field validation
    if (!startTime || !endTime || !visitorName || !visitorEmail) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const parsedStartTime = new Date(startTime);
    const parsedEndTime = new Date(endTime);

    if (isNaN(parsedStartTime.getTime()) || isNaN(parsedEndTime.getTime())) {
      return res.status(400).json({ message: 'Invalid start or end time' });
    }

    if (parsedEndTime <= parsedStartTime) {
      return res.status(400).json({ message: 'End time must be after start time' });
    }

    console.log("REACHED STEP 2")
    const shareLink = await prisma.calendarShareLink.findUnique({
      where: { token },
      include: { user: true }
    });

    if (!shareLink || new Date() > shareLink.expiresAt || !shareLink.isActive) {
      return res.status(410).json({ message: 'Link expired or inactive' });
    }

    const user = shareLink.user;

    if (!user.googleRefreshToken) {
      return res.status(401).json({ message: 'User not connected to Google Calendar' });
    }

    console.log("REACHED STEP 3")
    const {
      availableStart,
      availableEnd,
      earliestHour,
      latestHour,
      allowWeekends,
      timezone,
      slotDuration,
      bufferBetween
    } = shareLink;

    const now = new Date();
    if (parsedStartTime < availableStart || parsedEndTime > availableEnd) {
      return res.status(400).json({ message: 'Booking is outside the available period.' });
    }
    console.log("⏱️ parsedStartTime:", parsedStartTime.toISOString());
console.log("📅 availableStart:", availableStart.toISOString());
console.log("⏱️ parsedEndTime:", parsedEndTime.toISOString());
console.log("📅 availableEnd:", availableEnd.toISOString());
    const start = dayjs(parsedStartTime).tz(timezone);
const end = dayjs(parsedEndTime).tz(timezone);
const bookingStartHour = start.hour(); 
const bookingEndHour = end.hour();      
const bookingDay = start.day();         

if (
  bookingStartHour < earliestHour ||
  bookingEndHour > latestHour ||
  (!allowWeekends && [0, 6].includes(bookingDay))
) {
  return res.status(400).json({
    message: 'Booking is outside allowed hours or on a weekend.',
  });
}
    console.log("🕓 Checking hours:", {
  bookingStart: bookingStartHour,
  bookingEnd: bookingEndHour,
  earliest: earliestHour,
  latest: latestHour,
});
console.log("📆 Weekday:", parsedStartTime.getUTCDay(), "(Weekend check)");
    const actualSlotDuration = Math.floor((parsedEndTime.getTime() - parsedStartTime.getTime()) / (60 * 1000)); // in minutes

    if (actualSlotDuration !== slotDuration) {
      return res.status(400).json({ message: `Booking must be exactly ${slotDuration} minutes long.` });
    }

    console.log("REACHED STEP 4")
    const accessToken = await getValidAccessToken(user.id);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // 5. Check availability (FreeBusy)
    const freeBusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: parsedStartTime.toISOString(),
        timeMax: parsedEndTime.toISOString(),
        items: [{ id: 'primary' }]
      }
    });

    const busy = freeBusyRes.data.calendars?.primary?.busy || [];

    const isSlotBusy = busy.some(slot =>
      new Date(slot.start || '') < parsedEndTime &&
      parsedStartTime < new Date(slot.end || '')
    );

    if (isSlotBusy) {
      return res.status(409).json({ message: 'Time slot already booked. Please choose another.' });
    }

    console.log("REACHED STEP 4")
    const eventRes = await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      requestBody: {
        summary:  'Appointment',
        description: `Meeting booked by ${visitorName} (${visitorEmail}) via share link.`,
        start: {
          dateTime: parsedStartTime.toISOString(),
          timeZone: timezone
        },
        end: {
          dateTime: parsedEndTime.toISOString(),
          timeZone: timezone
        },
        attendees: [
          {
            email: visitorEmail,
            displayName: visitorName
          }
        ]
      }
    });

    // 7. Response
    return res.status(201).json({
      message: 'Meeting booked successfully!',
      eventId: eventRes.data.id,
      eventLink: eventRes.data.htmlLink,
      calendarResponse: eventRes.data
    });

  } catch (error: any) {
    console.error('❌ Booking failed:', error.message);
    return res.status(500).json({
      message: 'Something went wrong while booking.',
      error: error.message
    });
  }
});

export { getGoogleCalendarClient };
export default calendarRouter;