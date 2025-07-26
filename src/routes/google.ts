// src/routes/googleRouter.ts

import { Router, Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import prisma from '../utils/prisma';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
dotenv.config();

const googleRouter = Router();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error("Missing Google OAuth environment variables");
  process.exit(1);
}

async function refreshGoogleToken(userId: string, refreshToken: string) {
  try {
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token, expires_in, refresh_token: newRefreshToken } = tokenRes.data;
    const expiryTime = new Date(Date.now() + expires_in * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: access_token,
        googleRefreshToken: newRefreshToken || refreshToken, 
        accessTokenExpiry: expiryTime,
        calendarConnected: true 
      },
    });
    console.log("UPDATED THE TOKEN")
    return access_token;
  } catch (error: any) {
    console.error('Token refresh error:', error.response?.data || error.message);
    
    if (error.response?.status === 400 && error.response?.data?.error === 'invalid_grant') {
      throw new Error('Refresh token expired or invalid');
    }
    
    throw new Error('Failed to refresh token');
  }
}

async function getValidAccessToken(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleRefreshToken: true,
      accessTokenExpiry: true,
      calendarConnected: true
    }
  });

  if (!user || !user.calendarConnected || !user.googleRefreshToken) {
    throw new Error('User not connected to Google Calendar');
  }

  const now = new Date();
  const expiryBuffer = new Date(now.getTime() + 5 * 60 * 1000); 

  const needsRefresh = !user.googleAccessToken || 
                      !user.accessTokenExpiry || 
                      user.accessTokenExpiry <= expiryBuffer;

  if (needsRefresh) {
    console.log('Access token expired, missing, or expiring soon, refreshing...');
    try {
      return await refreshGoogleToken(userId, user.googleRefreshToken);
    } catch (error) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          calendarConnected: false,
          googleAccessToken: null,
          googleRefreshToken: null,
          accessTokenExpiry: null
        }
      });
      throw new Error('Failed to refresh token. User disconnected from calendar.');
    }
  }

  return user.googleAccessToken!;
}

googleRouter.get('/calendarStatus', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        calendarConnected: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        accessTokenExpiry: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let isTokenValid = false;
    if (user.calendarConnected && user.googleAccessToken && user.accessTokenExpiry) {
      const now = new Date();
      isTokenValid = user.accessTokenExpiry > now;
    }

    res.json({
      connected: user.calendarConnected || false,
      tokenValid: isTokenValid,
      hasRefreshToken: !!user.googleRefreshToken
    });

  } catch (error: any) {
    console.error('Calendar status error:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    
    res.status(500).json({ message: 'Internal server error' });
  }
});

googleRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  console.log("REACHED THE CALLBACK")
  if (!code || !state) {
    return res.status(400).json({ message: 'Missing code or state' });
  }

  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string };
    const userId = decoded.userId;

    // 🔁 Exchange code for tokens
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in
    } = tokenRes.data;

    const expiryTime = new Date(Date.now() + expires_in * 1000);

    // ✅ Update user and store tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        calendarConnected: true,
        googleAccessToken: access_token,
        googleRefreshToken: refresh_token,
        accessTokenExpiry: expiryTime
      },
    });

    // ✅ Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!
    );
    oauth2Client.setCredentials({ access_token });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // ✅ Generate unique channel ID
    const channelId = uuidv4();
    const webhookUrl = 'https://ad0c7d510e33.ngrok-free.app/api/v1/google/webhook'; // replace with yours

    // ✅ Create watch channel
    const watchRes = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: userId, 
      },
    });
    console.log('🔔 Watch channel created:', {
  channelId,
  kind: watchRes.data.kind,
  resourceUri: watchRes.data.resourceUri,
});
    const resourceId = watchRes.data.resourceId!;
    const expirationMillis = parseInt(watchRes.data.expiration || '0');
    const expirationTime = new Date(expirationMillis);

    console.log('🔔 Watch channel created:', {
      channelId,
      resourceId,
      expiration: expirationTime
    });

    // ✅ Save channel info to CalendarChannel table
    await prisma.calendarChannel.create({
      data: {
        userId,
        channelId,
        resourceId,
        expiration: expirationTime,
        token: userId // optional, if you want to verify in webhook
      }
    });

    // ✅ Redirect back to frontend
    res.redirect(`${process.env.CLIENT_URL}/dashboard?calendarConnected=true`);
  } catch (err: any) {
    console.error('Calendar OAuth Error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to complete calendar connection.' });
  }
});
googleRouter.post('/webhook', async (req, res) => {
  try {
    console.log("REACHED THE WEBHOOK")
    const channelId = req.get('X-Goog-Channel-Id');
    const resourceState = req.get('X-Goog-Resource-State'); // 'exists', 'sync', 'not_exists'
    const resourceId = req.get('X-Goog-Resource-Id');
    const changed = req.get('X-Goog-Changed'); // optional

    if (resourceState === 'sync') {
      return res.status(200).send('Sync handshake received.');
    }

    // 🔍 Lookup the channel in the DB to get the user
    const channel = await prisma.calendarChannel.findFirst({
      where: { channelId },
      include: { user: true } // Get the user's credentials directly
    });
    if (!channel || !channel.user) {
      console.warn('⚠️ Unknown channelId or user not found:', channelId);
      return res.status(404).json({ message: 'Channel or user not found' });
    }

    const { googleAccessToken, googleRefreshToken, accessTokenExpiry } = channel.user;

    // ♻️ Get a fresh valid access token for this user
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: googleAccessToken,
      refresh_token: googleRefreshToken
    });

    // Optionally refresh token if expired
    if (!googleAccessToken || !accessTokenExpiry || new Date() > accessTokenExpiry) {
      const tokens = await oauth2Client.refreshAccessToken();
      const { access_token, expiry_date, refresh_token } = tokens.credentials;

      await prisma.user.update({
        where: { id: channel.userId },
        data: {
          googleAccessToken: access_token!,
          accessTokenExpiry: expiry_date ? new Date(expiry_date) : undefined,
          googleRefreshToken: refresh_token ?? googleRefreshToken
        }
      });

      oauth2Client.setCredentials({ access_token });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const past = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: past.toISOString(),
      timeMax: now.toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 10,
      orderBy: 'updated'
    });

    console.log(`📅 Fetched ${events.data.items?.length} recently updated events`);

    // ✅ Process each updated event
    for (const event of events.data.items || []) {
      console.log(`🔄 Processing event: ${event.summary} (${event.id})`);

      // EXAMPLE: Update event status in your DB if you track via googleEventId
      if (event.id) {
        
        await prisma.meeting.updateMany({
          where: { googleEventId: event.id },
          data: {
            // Add desired update logic here
            title: event.summary || 'Untitled',
            startTime: new Date(event.start?.dateTime || event.start?.date || now),
            endTime: new Date(event.end?.dateTime || event.end?.date || now),
            status:
                  event.status === 'cancelled'
                    ? 'cancelled'
                    : event.status === 'confirmed'
                    ? 'confirmed'
                    : 'tentative'
          }
        });
        console.log(event.status)

        const attendees = event.attendees || [];
        for (const attendee of attendees) {
          if (attendee.email) {
            const user = await prisma.user.findUnique({
              where: { email: attendee.email }
            });
            console.log(`MeetingAttendee updated for user ${user!.id} on event ${event.status}`);
            if (user) {
              await prisma.meetingAttendee.updateMany({
                where: {
                  userId: user.id,
                  meeting: {
                    googleEventId: event.id
                  }
                },
                data: {
                  status:
                    attendee.responseStatus === 'accepted'
                      ? 'accepted'
                      : attendee.responseStatus === 'declined'
                      ? 'declined'
                      : attendee.responseStatus === 'tentative'
                      ? 'tentative'
                      : 'pending'
                }
              });
                console.log(`MeetingAttendee updated for user ${user.id} on event ${event.id}`);
            }
          }
        }
      }
    }

    res.status(200).end();
  } catch (err: any) {
    console.error('❌ Webhook handler error:', err.message);
    res.status(500).end();
  }
});
export { refreshGoogleToken, getValidAccessToken };
export default googleRouter;