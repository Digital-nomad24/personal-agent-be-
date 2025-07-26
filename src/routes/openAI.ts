import { Router, Request, Response } from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const openaiRouter = Router();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const userInputSchema = z.object({
  message: z.string().min(1)
});
// function convertIstToUtc(istDateStr: string): string {
//   const [datePart, timePart] = istDateStr.split("T");
//   const [year, month, day] = datePart.split("-").map(Number);
//   const [hour, minute] = timePart.split(":").map(Number);

//   const utcDate = new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30));

//   // Add a 10-minute buffer to avoid "past" errors
//   utcDate.setMinutes(utcDate.getMinutes() + 10);

//   return utcDate.toISOString();
// }
openaiRouter.post('/extract-task', async (req: Request, res: Response) => {
  try {
    const { message } = userInputSchema.parse(req.body);
    
    // Get current IST datetime
const now = new Date();
const istDateTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
const adjustedDateTime = new Date(istDateTime.getTime() + (5.5 * 60 * 60 * 1000)); // Add another 5:30 hours
const currentAdjustedDateTime = adjustedDateTime.toISOString().slice(0, 16);

const systemPrompt = `
You are a helpful assistant that extracts structured task details from user messages.
A task is any actionable item such as a meeting, reminder, deadline, or to-do (e.g., "arrange a meet", "submit the form", "remind me", "complete assignment", etc.).
Even if the message is casual or implicit, extract the task if it's clearly something the user intends to do.

Examples:
- "I have to meet Aman tomorrow at 11am" → this is a task.
- "Remind me to email Priya about the project by Friday" → this is a task.
- "Let's plan something soon" → not a task.

Users may refer to dates using phrases like "tomorrow", "the day after", "next Monday", or "in 3 days" — interpret these based on the current date and time.

**Current date and time (IST timezone): ${currentAdjustedDateTime}**

IMPORTANT: When returning dueDate, add 5 hours and 30 minutes to the IST time to account for UTC conversion. For example:
- If user says "tomorrow at 2:30 PM" and that would be "2025-07-16T14:30" in IST
- Return it as "2025-07-16T20:00" (adding 5:30 hours)

When a task is found, respond with **only** the following strict JSON format (no extra text):
{
  "title": "...",                     // short, meaningful title (e.g., "Meet with Aman")
  "status": "pending",                // always set to "pending" for new tasks
  "priority": "high | medium | low",  // infer based on urgency, deadlines, or importance. Default to "medium" if unclear
  "dueDate": "YYYY-MM-DDTHH:MM"      // IST time + 5:30 hours to account for UTC storage
}

Priority Guidelines:
- high: Urgent deadlines, work meetings, important appointments
- medium: Regular tasks, general reminders, routine activities
- low: Optional tasks, future planning, non-urgent items

When there is no clear task, respond conversationally and DO NOT return any JSON.
Be concise and accurate.
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
    });

    const rawContent = response.choices[0].message.content;
    console.log(rawContent)
    if (!rawContent) {
      return res.status(500).json({ message: 'No response from AI.' });
    }

    try {
      const match = rawContent.match(/\{[\s\S]*\}/);
      
      if (!match) {
        return res.status(200).json({ 
          isTask: false,
          message: rawContent.trim()
        });
      }
      
      const parsed = JSON.parse(match[0]);
      
      const taskSchema = z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(['pending', 'completed']),
        priority: z.enum(['high', 'medium', 'low']),
        dueDate: z.string().nullable().optional()
      });
      
      const validatedTask = taskSchema.parse(parsed);
      const taskData = {
        title: validatedTask.title,
        description: validatedTask.description || '',
        status: validatedTask.status,
        priority: validatedTask.priority,
        dueDate: validatedTask.dueDate ? new Date(validatedTask.dueDate).toISOString() : null
      };
      
      return res.status(200).json({ 
        isTask: true,
        task: taskData 
      });
      
    } catch (e) {
      console.error('Error parsing JSON from OpenAI response:', rawContent);
      return res.status(200).json({ 
        isTask: false,
        message: rawContent.trim()
      });
    }

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during OpenAI task extraction:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default openaiRouter;