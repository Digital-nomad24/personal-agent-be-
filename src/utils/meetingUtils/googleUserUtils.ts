import { google } from 'googleapis';

export async function verifyUserInfo(accessToken: string, expectedEmail: string) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    console.log("✅ [USER VERIFY] User info retrieved:", {
      email: userInfo.data.email,
      name: userInfo.data.name
    });

    if (userInfo.data.email !== expectedEmail) {
      console.log("❌ [USER VERIFY] Email mismatch:", {
        expected: expectedEmail,
        received: userInfo.data.email
      });
      throw new Error('Email mismatch. Please sign in with the correct account.');
    }

    return {
      email: userInfo.data.email!,
      name: userInfo.data.name!,
      picture: userInfo.data.picture
    };
  } catch (error: any) {
    console.error('❌ [USER VERIFY] Failed to get user info:', error.message);
    throw new Error('Failed to verify user identity');
  }
}