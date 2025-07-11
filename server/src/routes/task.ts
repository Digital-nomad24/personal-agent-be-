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
import { getPriorityOrder } from '../utils/priorityMapping'; // Import the new utility

const tasksRouter = Router();

// --- CREATE Task Route ---
// POST /api/v1/tasks
tasksRouter.post('/', authMiddleware, async (req: Request<{}, {}, CreateTaskInput>, res: Response) => {
  const userId = req.userId;
  console.log("IDHR PAHUCHA backend route mein")
  
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    // Validate request body using Zod
    const { title, status, priority, completionDate } = createTaskInput.parse(req.body);

    // Calculate priorityOrder based on the provided priority
    const priorityOrder = getPriorityOrder(priority);

    let parsedCompletionDate: Date;
    try {
        parsedCompletionDate = new Date(completionDate);
    } catch (dateError) {
        return res.status(400).json({ message: 'Invalid completionDate format provided.' });
    }

    const newTask = await prisma.task.create({
      data: {
        title,
        status,
        priority,
        priorityOrder, // Include the calculated priorityOrder
        completionDate: parsedCompletionDate, // Use the parsed Date object
        userId: userId, // Link task to the authenticated user
      },
      select: { // Select only necessary fields to return
        id: true,
        title: true,
        status: true,
        priority: true,
        priorityOrder: true, // Include in response
        userId: true,
        completionDate: true,
        createdAt: true, // Also include createdAt for consistency
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

// --- FETCH (READ) Tasks Route ---
// GET /api/v1/tasks
// Optional query parameters: ?status=PENDING&priority=High&search=keyword
tasksRouter.get('/', authMiddleware, async (req: Request<{}, {}, {}, FetchTasksQuery>, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User ID not found in token or invalid.' });
  }

  try {
    const { status, priority, search } = fetchTasksQuery.parse(req.query);

    const whereClause: any = {
      userId: userId, // Always filter by the authenticated user's ID
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
        mode: 'insensitive', // Case-insensitive search
      };
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      orderBy: [
        {
          priorityOrder: 'asc', // Primary sort: High (1) -> Medium (2) -> Low (3)
        },
        {
          createdAt: 'desc', // Secondary sort: Newest first
        },
      ],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        priorityOrder: true, // Include in response
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

    // Handle completionDate specifically if it's being updated
    if (updateData.completionDate !== undefined) {
      if (updateData.completionDate === null) {
        prismaUpdateData.completionDate = null; // Set to null to clear the date in DB
      } else {
        try {
          const parsedDate = new Date(updateData.completionDate);
          if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ message: 'Invalid completionDate format.' });
          }
          prismaUpdateData.completionDate = parsedDate;
        } catch (dateError) {
            return res.status(400).json({ message: 'Invalid completionDate format.', details: dateError });
        }
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
        status: true,
        priority: true,
        priorityOrder: true, // Include in response
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

// --- DELETE Task Route ---
// DELETE /api/v1/tasks/:taskId
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