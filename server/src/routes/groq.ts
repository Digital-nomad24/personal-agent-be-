import { Router, Request, Response } from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

dotenv.config();

const groqRouter = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const userInputSchema = z.object({
  message: z.string().min(1)
});

groqRouter.post('/extract-task', async (req: Request, res: Response) => {
  try {
    const { message } = userInputSchema.parse(req.body);

    const systemPrompt = `You are a helpful assistant. Extract structured task details from the user's message.
Respond in a strict JSON format like:
{
  "taskName": "...",
  "priority": "High | Medium | Low",
  "completionDate": "YYYY-MM-DD"
}`;

    const response = await groq.chat.completions.create({
      model: 'llama3-8b-8192', // or mixtral-8x7b-32768
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      return res.status(500).json({ message: 'No response from AI.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error('Error parsing JSON from Groq response:', rawContent);
      return res.status(500).json({ message: 'Failed to parse structured output from AI.' });
    }

    res.status(200).json({ task: parsed });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during Groq task extraction:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default groqRouter;
