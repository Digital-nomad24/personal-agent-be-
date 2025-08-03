import axios from 'axios';

export async function exchangeOAuthTokens(code: string) {
  try {
    const tokenRes = await axios.post(
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
    console.log("✅ [OAUTH] OAuth token exchange successful");
    return tokenRes.data;
  } catch (error: any) {
    console.error('❌ [OAUTH] OAuth token exchange failed:', error.response?.data || error.message);
    throw new Error('OAuth authentication failed');
  }
}