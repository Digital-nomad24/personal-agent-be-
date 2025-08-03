import { setRedisData } from "../../routes/gmail";
import prisma from "../prisma";


export async function storeTokensInRedis(targetEmail: string, tokenData: any, userInfo: any, accessRequestId: string) {
  const redisKey = `calendar_token:${targetEmail}`;
  const storedTokenData = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    userInfo: {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    },
    accessRequestId: accessRequestId
  };

  try {
    await setRedisData(redisKey, storedTokenData, 24 * 60 * 60);
    console.log(`✅ [REDIS STORE] Stored tokens in Redis for ${targetEmail}`);
    return storedTokenData;
  } catch (error) {
    console.error('❌ [REDIS STORE] Failed to store tokens in Redis:', error);
    throw new Error('Failed to store calendar access tokens');
  }
}

export async function updateAccessRequestStatus(accessRequestId: string) {
  await prisma.calendarAccessRequest.update({
    where: { id: accessRequestId },
    data: {
      status: 'approved',
      respondedAt: new Date(),
    }
  });
}
