import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth';
import { getGoogleCalendarClient } from './calendar';

const meetingsRouter = Router();
meetingsRouter.post('/createMeeting', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      groupId,
      title,
      description,
      startTime,
      endTime,
      location,
      attendeeIds 
    } = req.body;

    if (!groupId || !title || !startTime || !endTime) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Ensure user is in the group
    const isMember = await prisma.groupMembership.findUnique({
      where: { userId_groupId: { userId, groupId } }
    });
    if (!isMember) {
      return res.status(403).json({ message: 'Forbidden: not a group member' });
    }

    // Optional: attendeeIds, else default to all group members
    let attendees = attendeeIds;
    if (!attendees) {
      const groupMembers = await prisma.groupMembership.findMany({
        where: { groupId },
        select: { userId: true }
      });
      attendees = groupMembers.map(m => m.userId);
    }
    if (!attendees.includes(userId)) attendees.push(userId);

    // ✅ Fetch attendee emails
    const attendeeUsers = await prisma.user.findMany({
      where: {
        id: { in: attendees }
      },
      select: { id: true, email: true }
    });
    const emailMap = new Map(attendeeUsers.map(u => [u.id, u.email]));

    // Step 1: Create meeting in DB
    const meeting = await prisma.meeting.create({
      data: {
        title,
        description,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration: Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000),
        location,
        groupId,
        organizerId: userId,
        attendees: {
          create: attendees.map((uid: string) => ({
            userId: uid,
            status: uid === userId ? 'accepted' : 'pending'
          }))
        }
      }
    });

    let googleEventId = null;
    let calendarLink = null;

    // Step 2: Push to Google Calendar (if calendar is connected)
    try {
      const calendar = await getGoogleCalendarClient(userId); // you must have this util

      const calendarRes = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: title,
          description,
          location,
          start: {
            dateTime: new Date(startTime).toISOString(),
            timeZone: 'UTC'
          },
          end: {
            dateTime: new Date(endTime).toISOString(),
            timeZone: 'UTC'
          },
          attendees: Array.from(emailMap.values()).map(email => ({ email })),
          conferenceData: {
            createRequest: {
              requestId: `meet-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            }
          }
        },
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });
      const googleEvent = calendarRes.data;
      googleEventId = googleEvent.id || null;
      calendarLink = googleEvent.hangoutLink || googleEvent.htmlLink || null;

      // Update meeting with Google Calendar info
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          googleEventId,
          meetingLink: calendarLink
        }
      });
    } catch (calendarError: any) {
      console.warn(`⚠️ Google Calendar integration failed: ${calendarError.message}`);
      // Continue without crashing; still return the created meeting
    }

    // Step 3: Return response
    const fullMeeting = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      include: {
        attendees: {
          include: { user: { select: { name: true, email: true } } }
        }
      }
    });

    res.status(201).json({
      message: 'Meeting created successfully',
      meeting: fullMeeting
    });
  } catch (err: any) {
    console.error('Meeting creation error:', err.message);
    res.status(500).json({ message: 'Failed to create meeting' });
  }
});

export default meetingsRouter