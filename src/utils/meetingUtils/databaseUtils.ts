import prisma from "../prisma";

export async function findAccessRequest(token: string) {
  const accessRequest = await prisma.calendarAccessRequest.findUnique({
    where: { token },
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
          meetingId: true,
          finalMeeting: {
            select: {
              title: true,
              description: true,
              duration: true,
              location: true
            }
          }
        }
      }
    }
  });

  return accessRequest;
}
