import { google } from 'googleapis';
import prisma from '../prisma';

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
        token: userId
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