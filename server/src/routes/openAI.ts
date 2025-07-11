// src/routes/openai.ts
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

openaiRouter.post('/extract-task', async (req: Request, res: Response) => {
  try {
    const { message } = userInputSchema.parse(req.body);

    const systemPrompt = `
You are a helpful assistant that extracts structured task details from user messages.

A task is any actionable item such as a meeting, reminder, deadline, or to-do (e.g., "arrange a meet", "submit the form", "remind me", "complete assignment", etc.).

Even if the message is casual or implicit, extract the task if it's clearly something the user intends to do. Examples:
- "I have to meet Aman tomorrow at 11am" → this is a task.
- "Remind me to email Priya" → this is a task.
- "Let’s plan something soon" → not a task.
Users may refer to dates using phrases like **"tomorrow"**, **"the day after"**, **"next Monday"**, or **"in 3 days"** — interpret these and convert them into actual dates in "YYYY-MM-DD" format using the current date.
When a task is found, respond with **only** the following strict JSON format (no extra text):
{
  "taskName": "...",                // short, meaningful title (e.g., "Arrange meeting with Aman")
  "priority": "High | Medium | Low", // infer based on urgency if not directly stated
  "completionDate": "YYYY-MM-DD"     // infer from natural phrases like "tomorrow", "next Monday", etc.
}

When there is no clear task, respond conversationally and DO NOT return any JSON.
Be concise and accurate.
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const rawContent = response.choices[0].message.content;

    if (!rawContent) {
      return res.status(500).json({ message: 'No response from AI.' });
    }

let parsed;
try {
  const match = rawContent.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response.');

  parsed = JSON.parse(match[0]);
} catch (e) {
  console.error('Error parsing JSON from OpenAI response:', rawContent);
  return res.status(500).json({ message: 'Failed to parse structured output from AI.' });
}

    res.status(200).json({ task: parsed });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during OpenAI task extraction:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default openaiRouter;
