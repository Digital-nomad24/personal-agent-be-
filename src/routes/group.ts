// src/routes/groupRouter.ts

import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth';

const groupRouter = Router();

groupRouter.post('/createGroup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is not valid' });
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Group name is required' });
    }

    const group = await prisma.group.create({
      data: {
        name,
        members: {
          create: {
            userId,
            role: 'admin', 
          }
        }
      }
    });

    res.status(201).json({
      message: 'Group created successfully',
      group
    });

  } catch (error: any) {
    console.error('Create group error:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});

groupRouter.get('/listUserGroups', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;   
    const memberships = await prisma.groupMembership.findMany({
      where: { userId },
      include: { group: true }
    });

    const groups = memberships.map(m => ({
      groupId: m.group.id,
      groupName: m.group.name,
      role: m.role
    }));

    if (!groups) {
      return res.status(404).json({ message: 'Groups not found' });
    }

    return res.json({
      groupExists: true,
      isInGroup: groups.length,
      groups
    });
  } catch (error: any) {
    console.error('List user groups error:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

groupRouter.post('/joinGroup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = req.query.groupId as string;

    if (!groupId) {
      return res.status(400).json({ message: 'Missing groupId' });
    }

    // Check if group exists
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const existingMembership = await prisma.groupMembership.findUnique({
      where: {
        userId_groupId: {
          userId,
          groupId
        }
      }
    });

    if (existingMembership) {
      return res.status(400).json({ message: 'User is already a member of the group' });
    }

    const membership = await prisma.groupMembership.create({
      data: {
        userId,
        groupId,
        role: 'member'
      }
    });

    return res.status(201).json({
      message: 'User successfully joined the group',
      membership
    });
  } catch (error: any) {
    console.error('Join group error:', error.message);

    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'User already joined the group' }); // fallback for unique constraint
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});

groupRouter.post('/leaveGroup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = req.query.groupId as string;

    if (!groupId) {
      return res.status(400).json({ message: 'Missing groupId' });
    }

    // Check if membership exists
    const membership = await prisma.groupMembership.findUnique({
      where: {
        userId_groupId: {
          userId,
          groupId
        }
      }
    });

    if (!membership) {
      return res.status(404).json({ message: 'User is not a member of this group' });
    }

    // Delete the membership
    await prisma.groupMembership.delete({
      where: {
        userId_groupId: {
          userId,
          groupId
        }
      }
    });

    res.status(200).json({ message: 'Successfully left the group' });

  } catch (error: any) {
    console.error('Leave group error:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// List all users in a group
groupRouter.get('/listGroupUsers', authMiddleware, async (req: Request, res: Response) => {
  try {
    const groupId = req.query.groupId as string;
    if (!groupId) {
      return res.status(400).json({ message: 'Missing groupId' });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const users = group.members.map(member => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role
    }));

    console.log(users);
    res.json({
      groupId: group.id,
      groupName: group.name,
      users
    });
  } catch (error: any) {
    console.error('List group users error:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});

export default groupRouter;