// src/routes/meetingRouter.ts
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import prisma from '../utils/prisma';
import { sendCalendarAccessEmail } from '../services/gmailService';
import axios from 'axios';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import {client} from "../index" // Adjust the path to where your function is
import { sendTelegramMessage } from '../services/telegramService';
import { generateToken } from './auth';
import { processIndividualMeetingRequest } from '../utils/approve-callback.utils';



const JWT_SECRET = process.env.JWT_SECRET as string;

const gmailRouter = Router();
export async function getValidExternalAccessToken(targetEmail: string) {
  const redisKey = `calendar_token:${targetEmail}`;
  const tokenData = await getRedisData(redisKey);

  if (!tokenData || !tokenData.refreshToken) {
    throw new Error('External user not connected to Google Calendar or missing refresh token');
  }

  const now = new Date();
  const expiryBuffer = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes buffer

  const needsRefresh = !tokenData.accessToken || 
                      !tokenData.expiresAt || 
                      new Date(tokenData.expiresAt) <= expiryBuffer;

  if (needsRefresh) {
    console.log(`🔄 Access token expired for ${targetEmail}, refreshing...`);
    try {
      return await refreshExternalGoogleToken(targetEmail, tokenData.refreshToken, tokenData);
    } catch (error) {
      // Remove invalid token from Redis
      await deleteRedisData(redisKey);
      throw new Error('Failed to refresh external token. User needs to re-approve access.');
    }
  }

  return tokenData.accessToken;
}

export async function refreshExternalGoogleToken(targetEmail: string, refreshToken: string, existingTokenData: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    const newExpiryDate = credentials.expiry_date 
      ? new Date(credentials.expiry_date) 
      : new Date(Date.now() + 3600 * 1000); // Default 1 hour if not provided

    // Update Redis with new token data
    const updatedTokenData = {
      ...existingTokenData,
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || refreshToken, // Keep old refresh token if new one not provided
      expiresAt: newExpiryDate.toISOString(),
      tokenType: credentials.token_type || 'Bearer',
      updatedAt: new Date().toISOString()
    };

    const redisKey = `calendar_token:${targetEmail}`;
    await setRedisData(redisKey, updatedTokenData, 30 * 24 * 60 * 60); // 30 days TTL

    console.log(`✅ Successfully refreshed token for ${targetEmail}`);
    
    return credentials.access_token!;
  } catch (error: any) {
    console.error(`❌ Failed to refresh token for ${targetEmail}:`, error.message);
    throw new Error(`Token refresh failed: ${error.message}`);
  }
}

// Helper function to get OAuth2 client with valid token
export async function getExternalOAuth2Client(targetEmail: string) {
  const accessToken = await getValidExternalAccessToken(targetEmail);
  const redisKey = `calendar_token:${targetEmail}`;
  const tokenData = await getRedisData(redisKey);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: tokenData.refreshToken,
    token_type: tokenData.tokenType || 'Bearer'
  });

  return oauth2Client;
}

// Fixed Redis helper functions with error handling
export async function setRedisData(key: string, data: any, expiry: number) {
  try {
    if (!client.isReady) {
      throw new Error('Redis client not ready');
    }
    await client.set(key, JSON.stringify(data), { EX: expiry });
    return true;
  } catch (error) {
    console.error('Redis SET error:', error);
    throw new Error('Failed to store data in Redis');
  }
}

export async function getRedisData(key: string) {
  try {
    if (!client.isReady) {
      throw new Error('Redis client not ready');
    }
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
}

export async function deleteRedisData(key: string) {
  try {
    if (!client.isReady) {
      throw new Error('Redis client not ready');
    }
    await client.del(key);
    return true;
  } catch (error) {
    console.error('Redis DELETE error:', error);
    return false;
  }
}

// POST /api/v1/meetings/request
gmailRouter.post('/request', authMiddleware, async (req: Request, res: Response) => {
  console.log("REACHED THE GMAIL ROUTES");
  
  try {
    const userId = req.userId!;
    
    const {
      title,
      duration,
      targetEmail,
      purpose,
      preferredTimeframe,
      location,
      meetingLink
    } = req.body;

    if (!title || !duration || !targetEmail) {
      return res.status(400).json({ 
        message: 'Missing required fields: title, duration, targetEmail' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail) || targetEmail.length > 254) {
      return res.status(400).json({ 
        message: 'Invalid email format' 
      });
    }

    // Validate duration (15 min to 8 hours)
    if (duration < 15 || duration > 480) {
      return res.status(400).json({ 
        message: 'Duration must be between 15 and 480 minutes' 
      });
    }

    // Validate title length
    if (title.length > 200) {
      return res.status(400).json({ 
        message: 'Title must be less than 200 characters' 
      });
    }

    console.log(`📅 Creating meeting request: ${title} with ${targetEmail}`);

    // Get requester info first
    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true }
    });

    if (!requester) {
      return res.status(404).json({ message: 'Requester not found' });
    }

    // Check if target user is already in our system
    const targetUser = await prisma.user.findUnique({
      where: { email: targetEmail },
      select: { id: true, name: true, email: true }
    });

    // Fixed: Use database transaction for related operations
    const result = await prisma.$transaction(async (tx) => {
      // Generate unique token with more context - Fixed expiry to match database
      const token = jwt.sign({ 
        userId,
        type: 'calendar_access_request',
        targetEmail,
        purpose: `${title} - ${purpose || 'Meeting request'}`,
        iat: Math.floor(Date.now() / 1000)
      }, JWT_SECRET, { expiresIn: '48h' }); // Match database expiry

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

      // Create CalendarAccessRequest - FIXED: Use actual variables instead of hardcoded values
      const accessRequestData: any = {
        requesterUser: {
          connect: { id: userId }, // Use actual userId from request
        },
        targetEmail: targetEmail, // Use actual targetEmail from request
        token,
        purpose: `${title} - ${purpose || 'Meeting request'}`, // Use actual title and purpose
        status: "pending",
        expiresAt: expiresAt, // Use calculated expiry date
        preferredDuration: duration, // Use actual duration from request
        preferredTimeframe: preferredTimeframe || "this week", // Use actual timeframe
      };

      // Only add targetUserId if targetUser exists
      if (targetUser?.id) {
        accessRequestData.targetUserId = targetUser.id;
      }

      // Only add location if it exists and is a valid string
      if (location && typeof location === 'string' && location.trim() !== '') {
        accessRequestData.location = location.trim();
      }

      const accessRequest = await tx.calendarAccessRequest.create({
        data: accessRequestData,
      });

      const meetingRequest = await tx.meetingRequest.create({
        data: {
          requesterUserId: userId,
          accessRequestId: accessRequest.id
        }
      });

      return { accessRequest, meetingRequest };
    });

    const emailData = {
      targetEmail,
      targetName: targetUser?.name || 'there',
      requesterName: requester.name || requester.email,
      requesterEmail: requester.email,
      meetingTitle: title,
      meetingPurpose: purpose || 'Meeting discussion',
      duration,
      preferredTimeframe: preferredTimeframe || 'this week',
      approvalLink: `${process.env.CLIENT_URL}/calendar/approve/${result.accessRequest.token}`,
      expiresAt: result.accessRequest.expiresAt.toISOString()
    };

    try {
      await sendCalendarAccessEmail(req.userId!, emailData);
      console.log(`✅ Calendar access email sent to ${targetEmail}`);
    } catch (emailError: any) {
      console.error('❌ Failed to send email:', emailError.message);
      
      // Rollback: Delete the created records if email fails
      await prisma.meetingRequest.delete({ where: { id: result.meetingRequest.id } });
      await prisma.calendarAccessRequest.delete({ where: { id: result.accessRequest.id } });
      
      return res.status(500).json({ 
        message: 'Meeting request created but failed to send email notification' 
      });
    }

    // Return success response
    return res.status(201).json({
      message: 'Meeting request created successfully',
      requestId: result.meetingRequest.id,
      accessRequestId: result.accessRequest.id,
      targetEmail,
      expiresAt: result.accessRequest.expiresAt.toISOString(),
      approvalLink: emailData.approvalLink,
      status: 'pending'
    });

  } catch (error: any) {
    console.error('❌ Error creating meeting request:', error);
    return res.status(500).json({ 
      message: 'Failed to create meeting request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
gmailRouter.get('/request-details/:token', async (req: Request, res: Response) => {
  console.log("REACHING HERE")
  try {
    const { token } = req.params;
    
    // Validate token parameter
    if (!token || token.trim() === '') {
      console.error('❌ Missing or empty token parameter');
      return res.status(400).json({ 
        success: false,
        message: 'Token parameter is required' 
      });
    }
    
    console.log(`📋 Fetching request details for token: ${token.substring(0, 20)}...`);
    
    // Verify and decode JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error) {
      console.error('❌ Invalid JWT token:', error);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired token' 
      });
    }

    // Validate token type
    if (decoded.type !== 'calendar_access_request') {
      console.error('❌ Invalid token type:', decoded.type);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid token type' 
      });
    }

    // Find the calendar access request in database
    const accessRequest = await prisma.calendarAccessRequest.findUnique({
      where: { token },
      include: {
        requesterUser: {
          select: { 
            id: true, 
            name: true, 
            email: true 
          }
        }
      }
    });

    if (!accessRequest) {
      console.error('❌ Request not found for token');
      return res.status(404).json({ 
        success: false,
        message: 'Request not found' 
      });
    }

    // Check if request has expired
    if (new Date() > accessRequest.expiresAt) {
      console.error('❌ Request has expired');
      return res.status(410).json({ 
        success: false,
        message: 'Request has expired' 
      });
    }

    // Check if already processed
    if (accessRequest.status !== 'pending') {
      console.error(`❌ Request already ${accessRequest.status}`);
      return res.status(409).json({ 
        success: false,
        message: `Request already ${accessRequest.status}`,
        status: accessRequest.status
      });
    }

    console.log(`✅ Valid request found for ${accessRequest.targetEmail}`);

    // Extract meeting details from purpose field (format: "title - purpose")
    const purposeParts = accessRequest.purpose?.split(' - ') || [];
    const title = purposeParts[0] || 'Meeting Request';
    const purpose = purposeParts[1] || accessRequest.purpose || 'No purpose specified';

    // Return request details for frontend
    const responseData = {
      success: true,
      data: {
        requestId: accessRequest.id,
        requesterName: accessRequest.requesterUser?.name || accessRequest.requesterUser?.email || 'Unknown',
        requesterEmail: accessRequest.requesterUser?.email || '',
        targetEmail: accessRequest.targetEmail,
        title: title,
        purpose: purpose,
        duration: accessRequest.preferredDuration || 30,
        preferredTimeframe: accessRequest.preferredTimeframe || 'Not specified',
        location: accessRequest.location || null,
        createdAt: accessRequest.createdAt,
        expiresAt: accessRequest.expiresAt,
        status: accessRequest.status
      }
    };

    // Ensure we're sending JSON with correct headers
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error('❌ Error fetching request details:', error);
    
    // Ensure JSON response even for errors
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      success: false,
      message: 'Failed to fetch request details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

gmailRouter.get('/approval-callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  
  console.log("📞 [STEP 1] REACHED THE APPROVAL CALLBACK");
  console.log("📞 [DEBUG] Query params:", { code: !!code, state: !!state });
  
  if (!code || !state) {
    console.log("❌ [STEP 1] Missing code or state");
    return res.status(400).json({ message: 'Missing code or state' });
  }

  try {
    console.log("🔐 [STEP 2] Starting JWT verification");
    // Decode the state (which is your original JWT from the email)
    let decoded;
    try {
      decoded = jwt.verify(state, JWT_SECRET) as {
        userId: string;
        type: string;
        targetEmail: string;
        purpose: string;
        iat: number;
        exp: number;
      };
      console.log("✅ [STEP 2] JWT decoded successfully:", {
        userId: decoded.userId,
        type: decoded.type,
        targetEmail: decoded.targetEmail,
        purpose: decoded.purpose
      });
    } catch (error) {
      console.log("❌ [STEP 2] JWT verification failed:", error);
      return res.status(400).json({ message: 'Invalid or expired state token' });
    }

    // Check if it's the right type
    if (decoded.type !== 'calendar_access_request') {
      console.log("❌ [STEP 2] Invalid state type:", decoded.type);
      return res.status(400).json({ message: 'Invalid state type' });
    }

    console.log(`🔓 [STEP 3] Processing approval callback for: ${decoded.targetEmail}`);

    // Exchange code for tokens
    console.log("🔄 [STEP 4] Starting OAuth token exchange");
    let tokenRes;
    try {
      tokenRes = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: process.env.GOOGLE_APPROVAL_REDIRECT_URI!,
          grant_type: 'authorization_code',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );
      console.log("✅ [STEP 4] OAuth token exchange successful");
    } catch (error: any) {
      console.error('❌ [STEP 4] OAuth token exchange failed:', error.response?.data || error.message);
      return res.status(500).json({ message: 'OAuth authentication failed' });
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    console.log("🎫 [STEP 4] Tokens received:", { 
      hasAccessToken: !!access_token, 
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in 
    });

    // Get and verify user info
    console.log("👤 [STEP 5] Getting user info");
    let userInfo;
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token });
      
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      userInfo = await oauth2.userinfo.get();
      console.log("✅ [STEP 5] User info retrieved:", {
        email: userInfo.data.email,
        name: userInfo.data.name
      });
    } catch (error: any) {
      console.error('❌ [STEP 5] Failed to get user info:', error.message);
      return res.status(500).json({ message: 'Failed to verify user identity' });
    }

    if (userInfo.data.email !== decoded.targetEmail) {
      console.log("❌ [STEP 5] Email mismatch:", {
        expected: decoded.targetEmail,
        received: userInfo.data.email
      });
      return res.status(403).json({ 
        message: 'Email mismatch. Please sign in with the correct account.' 
      });
    }

    console.log(`✅ [STEP 5] Email verified: ${userInfo.data.email}`);

    // Find access request using the original token
    console.log("🔍 [STEP 6] Finding access request in database");
    const accessRequest = await prisma.calendarAccessRequest.findUnique({
      where: { token: state },
      include: {
        requesterUser: {
          select: { id: true, name: true, email: true, telegramChatId: true }
        },
        meetingRequests: {
          select: { 
            id: true, 
            createdAt: true,
            updatedAt: true,
            slotOfferId: true,
            requesterUserId: true,
            accessRequestId: true,
            meetingId: true
          }
        }
      }
    });

    if (!accessRequest) {
      console.log("❌ [STEP 6] Access request not found in database");
      return res.status(404).json({ message: 'Access request not found' });
    }

    console.log("✅ [STEP 6] Access request found:", {
      id: accessRequest.id,
      status: accessRequest.status,
      meetingRequestsCount: accessRequest.meetingRequests.length,
      requesterUserId: accessRequest.requesterUser.id,
      requesterEmail: accessRequest.requesterUser.email
    });

    if (accessRequest.status !== 'pending') {
      console.log("❌ [STEP 6] Access request already processed:", accessRequest.status);
      return res.status(404).json({ message: 'Request already processed' });
    }

    // Store tokens in Redis
    console.log("💾 [STEP 7] Storing tokens in Redis");
    const redisKey = `calendar_token:${decoded.targetEmail}`;
    const tokenData = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
      userInfo: {
        email: userInfo.data.email,
        name: userInfo.data.name,
        picture: userInfo.data.picture
      },
      accessRequestId: accessRequest.id
    };

    try {
      await setRedisData(redisKey, tokenData, 24 * 60 * 60);
      console.log(`✅ [STEP 7] Stored tokens in Redis for ${decoded.targetEmail}`);
    } catch (error) {
      console.error('❌ [STEP 7] Failed to store tokens in Redis:', error);
      return res.status(500).json({ message: 'Failed to store calendar access tokens' });
    }

    // Update the access request status
    console.log("📋 [STEP 8] Updating access request status to approved");
    await prisma.calendarAccessRequest.update({
      where: { id: accessRequest.id },
      data: {
        status: 'approved',
        respondedAt: new Date(),
      }
    });

    console.log(`✅ [STEP 8] Updated access request ${accessRequest.id} to approved`);

    // Auto-process meeting requests after approval
    console.log(`🚀 [STEP 9] Starting auto-processing for ${accessRequest.meetingRequests.length} meeting requests...`);
    
    // Process each meeting request asynchronously (don't block the response)
    setImmediate(async () => {
      console.log("🔄 [ASYNC STEP 1] setImmediate callback started");
      console.log("🔄 [ASYNC DEBUG] Meeting requests to process:", accessRequest.meetingRequests.map(mr => ({
        id: mr.id,
        accessRequestId: mr.accessRequestId
      })));
      
      try {
        for (const meetingRequest of accessRequest.meetingRequests) {
          console.log(`🔄 [ASYNC STEP 2] Processing meeting request: ${meetingRequest.id}`);
          try {
            await processIndividualMeetingRequest(
              meetingRequest.id, 
              decoded.targetEmail, 
              accessRequest.requesterUser,
              accessRequest // Pass the APPROVED accessRequest
            );
            console.log(`✅ [ASYNC STEP 2] Successfully processed meeting request: ${meetingRequest.id}`);
          } catch (error) {
            console.error(`❌ [ASYNC STEP 2] Error processing meeting request ${meetingRequest.id}:`, error);
          }
        }
        console.log("✅ [ASYNC STEP 3] All meeting requests processed");
      } catch (error) {
        console.error("❌ [ASYNC ERROR] Fatal error in setImmediate callback:", error);
      }
    });

    // Redirect to success page
    console.log("🎉 [STEP 10] Redirecting to success page");
    const successUrl = `${process.env.CLIENT_URL}/calendar/approval-success?` +
      `email=${encodeURIComponent(decoded.targetEmail)}&` +
      `requester=${encodeURIComponent(accessRequest.requesterUser.name || accessRequest.requesterUser.email)}`;
    
    return res.redirect(successUrl);

  } catch (error: any) {
    console.error('❌ [FATAL ERROR] Approval callback error:', error);
    return res.status(500).json({ 
      message: 'OAuth authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ENHANCED: Function to process individual meeting requests with detailed debugging


gmailRouter.post('/external-availability', async (req: Request, res: Response) => {
  try {
    const { targetEmail, startDate, endDate } = req.body;
    const userId = req.userId!;

    if (!targetEmail || !startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Missing required fields: targetEmail, startDate, endDate' 
      });
    }

    // Validate date format
    if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
      return res.status(400).json({ 
        message: 'Invalid date format. Use ISO 8601 format.' 
      });
    }

    // Check if user has permission to access this calendar
    const redisKey = `calendar_token:${targetEmail}`;
    const tokenData = await getRedisData(redisKey);

    if (!tokenData) {
      return res.status(404).json({ 
        message: 'No valid calendar access found for this email. User may need to re-approve access.' 
      });
    }

    const accessRequest = await prisma.calendarAccessRequest.findFirst({
      where: {
        id: tokenData.accessRequestId,
        requesterUserId: userId,
        status: 'approved'
      }
    });

    if (!accessRequest) {
      return res.status(403).json({ 
        message: 'You do not have permission to access this calendar' 
      });
    }

    console.log(`📅 Fetching availability for ${targetEmail} from ${startDate} to ${endDate}`);

    // Get OAuth2 client with valid token (handles refresh automatically)
    const oauth2Client = await getExternalOAuth2Client(targetEmail);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Fetch busy times
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate,
        timeMax: endDate,
        timeZone: 'UTC',
        items: [{ id: 'primary' }]
      }
    });

    const busySlots = freeBusyResponse?.data.calendars?.primary?.busy || [];
    
    console.log(`📊 Found ${busySlots.length} busy slots for ${targetEmail}`);

    // Get updated token data (in case it was refreshed)
    const updatedTokenData = await getRedisData(redisKey);

    return res.json({
      targetEmail,
      timeRange: { startDate, endDate },
      busySlots,
      userInfo: updatedTokenData.userInfo,
      tokenExpiresAt: updatedTokenData.expiresAt
    });

  } catch (error: any) {
    console.error('❌ Error fetching external availability:', error);
    
    // Handle specific error cases
    if (error.message.includes('User needs to re-approve access') || 
        error.message.includes('not connected to Google Calendar')) {
      return res.status(401).json({ 
        message: error.message
      });
    }

    if (error.code === 401 || error.message.includes('Token refresh failed')) {
      const redisKey = `calendar_token:${req.body.targetEmail}`;
      await deleteRedisData(redisKey);
      
      return res.status(401).json({ 
        message: 'Calendar access expired. User needs to re-approve access.' 
      });
    }
    
    return res.status(500).json({ 
      message: 'Failed to fetch calendar availability',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// Route 4: Check approval status for a meeting request
gmailRouter.get('/request/:requestId/status',  async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.userId!;

    const meetingRequest = await prisma.meetingRequest.findFirst({
      where: { 
        id: requestId,
        requesterUserId: userId 
      },
      include: {
        accessRequest: {
          select: {
            status: true,
            respondedAt: true,
            expiresAt: true,
            targetEmail: true,
            token: true
          }
        }
      }
    });

    if (!meetingRequest) {
      return res.status(404).json({ message: 'Meeting request not found' });
    }

    let tokenStatus = 'unknown';
    if (meetingRequest.accessRequest?.status === 'approved' && meetingRequest.accessRequest.targetEmail) {
      // Check if tokens still exist in Redis with error handling
      const redisKey = `calendar_token:${meetingRequest.accessRequest.targetEmail}`;
      try {
        if (client.isReady) {
          const tokenExists = await client.exists(redisKey);
          tokenStatus = tokenExists ? 'active' : 'expired';
        } else {
          tokenStatus = 'redis_unavailable';
        }
      } catch (error) {
        console.error('Error checking Redis token status:', error);
        tokenStatus = 'error';
      }
    }

    return res.json({
      requestId,
      accessRequest: {
        status: meetingRequest.accessRequest?.status,
        approvedAt: meetingRequest.accessRequest?.respondedAt,
        expiresAt: meetingRequest.accessRequest?.expiresAt,
        targetEmail: meetingRequest.accessRequest?.targetEmail,
        tokenStatus
      }
    });

  } catch (error: any) {
    console.error('❌ Error checking request status:', error);
    return res.status(500).json({ message: 'Failed to check request status' });
  }
});



export default gmailRouter;