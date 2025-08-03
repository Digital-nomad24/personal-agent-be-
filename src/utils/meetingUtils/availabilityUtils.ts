import axios from 'axios';
import { generateToken } from '../../routes/auth';

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