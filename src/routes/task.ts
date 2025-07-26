// src/routes/tasks.ts
import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth';
import {
  createTaskInput,
  CreateTaskInput,
  updateTaskInput,
  UpdateTaskInput,
  fetchTasksQuery,
  FetchTasksQuery
} from '../utils/zodSchema';
import { getPriorityOrder } from '../utils/priorityMapping'; 
import { publishReminder } from '../pubsub/publisher';

const tasksRouter = Router();

tasksRouter.post('/', authMiddleware, async (req: Request<{}, {}, CreateTaskInput>, res: Response) => {
  const userId = req.userId;
 
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    const { title, status, priority, dueDate, description } = createTaskInput.parse(req.body);
    const priorityOrder = getPriorityOrder(priority);
    
    let parsedDueDate: Date | null = null;
    if (dueDate) {
      try {
        parsedDueDate = new Date(dueDate);
        if (isNaN(parsedDueDate.getTime())) {
          return res.status(400).json({ message: 'Invalid dueDate format provided.' });
        }
        
        if (parsedDueDate <= new Date()) {
          return res.status(400).json({ message: 'Due date must be in the future.' });
        }
      } catch (dateError) {
        return res.status(400).json({ message: 'Invalid dueDate format provided.' });
      }
    }

    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        status,
        priority,
        priorityOrder,
        dueDate: parsedDueDate,
        userId: userId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        priorityOrder: true,
        userId: true,
        dueDate: true,
        createdAt: true,
      }
    });

    res.status(201).json({
      message: 'Task created successfully!',
      task: newTask,
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        message: 'Invalid input data for task creation',
        errors: error.errors,
      });
    }
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Internal server error during task creation.' });
  }
});

tasksRouter.get('/', authMiddleware, async (req: Request<{}, {}, {}, FetchTasksQuery>, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    const { status, priority, search } = fetchTasksQuery.parse(req.query);

    const whereClause: any = {
      userId: userId, 
    };

    if (status) {
      whereClause.status = status;
    }
    if (priority) {
      whereClause.priority = priority;
    }
    if (search) {
      whereClause.title = {
        contains: search,
        mode: 'insensitive',
      };
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      orderBy: [
        {
          priorityOrder: 'asc',
        },
        {
          createdAt: 'desc',
        },{
          status:'desc'
        }
      ],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        priorityOrder: true, 
        dueDate: true,
        completionDate: true,
        createdAt: true,
      }
    });

    res.status(200).json({
      message: 'Tasks retrieved successfully!',
      tasks: tasks,
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        message: 'Invalid query parameters',
        errors: error.errors,
      });
    }
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Internal server error during task retrieval.' });
  }
});

// --- UPDATE Task Route ---
// PUT /api/v1/tasks/:taskId
tasksRouter.put('/:taskId', authMiddleware, async (req: Request<{ taskId: string }, {}, UpdateTaskInput>, res: Response) => {
  const userId = req.userId;
  const { taskId } = req.params;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    // Validate request body using Zod
    const updateData = updateTaskInput.parse(req.body);

    // Check if any fields are provided for update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No fields provided for update.' });
    }

    // Prepare data for Prisma update
    const prismaUpdateData: any = { ...updateData };

    // Handle priority update and calculate priorityOrder
    if (updateData.priority !== undefined) {
        prismaUpdateData.priorityOrder = getPriorityOrder(updateData.priority);
    }

    // Handle dueDate specifically if it's being updated
    if (updateData.dueDate !== undefined) {
      if (updateData.dueDate === null) {
        prismaUpdateData.dueDate = null; // Set to null to clear the date in DB
      } else {
        try {
          const parsedDate = new Date(updateData.dueDate);
          if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ message: 'Invalid dueDate format.' });
          }
          prismaUpdateData.dueDate = parsedDate;
        } catch (dateError) {
            return res.status(400).json({ message: 'Invalid dueDate format.', details: dateError });
        }
      }
    }

    // Handle completionDate when task is marked as completed
    if (updateData.status) {
      if (updateData.status === 'completed') {
        prismaUpdateData.completionDate = new Date(); // Set to current timestamp
      } else {
        // If status is changed to something other than completed, clear completionDate
        prismaUpdateData.completionDate = null;
      }
    }

    // Find the task and ensure it belongs to the authenticated user
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existingTask) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    if (existingTask.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden: You do not have permission to update this task.' });
    }

    // Perform the update
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: prismaUpdateData, // Use the prepared prismaUpdateData
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        priorityOrder: true, // Include in response
        dueDate: true,
        completionDate: true,
        createdAt: true,
        userId: true,
      }
    });

    res.status(200).json({
      message: 'Task updated successfully!',
      task: updatedTask,
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        message: 'Invalid input data for task update',
        errors: error.errors,
      });
    }
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'Internal server error during task update.' });
  }
});


tasksRouter.delete('/:taskId', authMiddleware, async (req: Request<{ taskId: string }>, res: Response) => {
  const userId = req.userId;
  const { taskId } = req.params;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    // Find the task and ensure it belongs to the authenticated user
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existingTask) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    if (existingTask.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden: You do not have permission to delete this task.' });
    }

    // Perform the delete operation
    await prisma.task.delete({
      where: { id: taskId },
    });

    res.status(200).json({ message: 'Task deleted successfully!' });

  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ message: 'Internal server error during task deletion.' });
  }
});


export default tasksRouter;