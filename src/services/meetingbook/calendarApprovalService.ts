// services/calendarApprovalService.ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { findAccessRequest } from '../../utils/meetingUtils/databaseUtils';
import { storeTokensInRedis, updateAccessRequestStatus } from '../../utils/meetingUtils/dataStorageUtils';
import { exchangeOAuthTokens } from '../../utils/meetingUtils/googleOAuthUtils';
import { verifyUserInfo } from '../../utils/meetingUtils/googleUserUtils';
import { generateSlotsAndSendTelegramMessage } from './slotGenerationService';

const JWT_SECRET = process.env.JWT_SECRET!;

export async function handleApprovalCallback(req: Request, res: Response) {
  const code = req.query.code as string;
  const state = req.query.state as string;
  
  console.log("📞 [STEP 1] REACHED THE APPROVAL CALLBACK");
  console.log("📞 [DEBUG] Query params:", { code: !!code, state: !!state });
  
  if (!code || !state) {
    console.log("❌ [STEP 1] Missing code or state");
    return res.status(400).json({ message: 'Missing code or state' });
  }

  try {
    // JWT Verification
    console.log("🔐 [STEP 2] Starting JWT verification");
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

    if (decoded.type !== 'calendar_access_request') {
      console.log("❌ [STEP 2] Invalid state type:", decoded.type);
      return res.status(400).json({ message: 'Invalid state type' });
    }

    console.log(`🔓 [STEP 3] Processing approval callback for: ${decoded.targetEmail}`);

    // Exchange OAuth tokens
    console.log("🔄 [STEP 4] Starting OAuth token exchange");
    const tokenData = await exchangeOAuthTokens(code);
    console.log("🎫 [STEP 4] Tokens received:", { 
      hasAccessToken: !!tokenData.access_token, 
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in 
    });

    // Verify user info
    console.log("👤 [STEP 5] Getting user info");
    const userInfo = await verifyUserInfo(tokenData.access_token, decoded.targetEmail);
    console.log(`✅ [STEP 5] Email verified: ${userInfo.email}`);

    // Find access request in database
    console.log("🔍 [STEP 6] Finding access request in database");
    const accessRequest = await findAccessRequest(state);
    
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
    const storedTokenData = await storeTokensInRedis(decoded.targetEmail, tokenData, userInfo, accessRequest.id);
    console.log(`✅ [STEP 7] Stored tokens in Redis for ${decoded.targetEmail}`);

    // Update access request status
    console.log("📋 [STEP 8] Updating access request status to approved");
    await updateAccessRequestStatus(accessRequest.id);
    console.log(`✅ [STEP 8] Updated access request ${accessRequest.id} to approved`);

    // Generate slots and send Telegram messages
    console.log(`📱 [STEP 9] Generating slots and sending Telegram messages...`);
    setImmediate(async () => {
      console.log("📱 [ASYNC STEP 1] Starting slot offer generation and Telegram notifications");
      console.log("📱 [ASYNC DEBUG] Meeting requests to process:", accessRequest.meetingRequests.map(mr => ({
        id: mr.id,
        title: mr.finalMeeting?.title || null,
        duration: mr.finalMeeting?.duration || null
      })));
      
      try {
        for (const meetingRequest of accessRequest.meetingRequests) {
          console.log(`📱 [ASYNC STEP 2] Processing meeting request: ${meetingRequest.id} - ${meetingRequest.finalMeeting?.title || 'No title'}`);
          try {
            await generateSlotsAndSendTelegramMessage(
              meetingRequest,
              decoded.targetEmail, 
              accessRequest.requesterUser,
              storedTokenData,
              accessRequest
            );
            console.log(`✅ [ASYNC STEP 2] Successfully sent slot selection for meeting request: ${meetingRequest.id}`);
          } catch (error) {
            console.error(`❌ [ASYNC STEP 2] Error processing meeting request ${meetingRequest.id}:`, error);
          }
        }
        console.log("✅ [ASYNC STEP 3] All slot selection messages sent");
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
}
