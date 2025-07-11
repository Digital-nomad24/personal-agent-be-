// src/utils/zodSchemas.ts
import { z } from 'zod';

export const signupInput = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(3, 'Name must be at least 3 characters long'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export type SignupInput = z.infer<typeof signupInput>;

export const signinInput = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password cannot be empty'),
});

export type SigninInput = z.infer<typeof signinInput>;

export const createTaskInput = z.object({
  title: z.string().min(1, 'Task title cannot be empty'),
  status: z.enum(['pending', 'completed'], {
    errorMap: () => ({ message: 'Status must be pending or completed' })
  }).default('pending'),
  priority: z.enum(['high', 'medium', 'low'], {
    errorMap: () => ({ message: 'Priority must be high, medium, or low' })
  }).default('medium'),
  completionDate: z.string() // Assuming date comes as a string (e.g., "YYYY-MM-DD")
});

export type CreateTaskInput = z.infer<typeof createTaskInput>;

// NEW: Schema for updating a task
export const updateTaskInput = z.object({
  title: z.string().min(1, 'Task title cannot be empty').optional(),
  status: z.enum(['pending', 'completed'], {
    errorMap: () => ({ message: 'Status must be pending or completed' })
  }).optional(),
  priority: z.enum(['high', 'medium', 'low'], {
    errorMap: () => ({ message: 'Priority must be high, medium, or low' })
  }).optional(),
  completionDate: z.string().optional() // Allow null to clear the date
});

export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

// NEW: Schema for fetching tasks with optional filters
export const fetchTasksQuery = z.object({
  status: z.enum(['pending', 'completed']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  search: z.string().optional(), // For searching by title
  // Add pagination/sorting if needed later
});

export type FetchTasksQuery = z.infer<typeof fetchTasksQuery>;