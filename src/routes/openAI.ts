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
openaiRouter.post('/extract-meeting', async (req: Request, res: Response) => {
  try {
    const { message } = userInputSchema.parse(req.body);
    const { systemPrompt } = req.body;
   
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
    });
   
    const rawContent = response.choices[0].message.content;
    console.log(rawContent);
   
    if (!rawContent) {
      return res.status(500).json({ message: 'No response from AI.' });
    }
   
    try {
      const match = rawContent.match(/\{[\s\S]*\}/);
     
      if (!match) {
        return res.status(200).json({
          isMeeting: false,
          message: rawContent.trim()
        });
      }
     
      const parsed = JSON.parse(match[0]);
     
      // Updated schema to match database expectations
      const meetingSchema = z.object({
        title: z.string().min(1).max(200), // Match title length validation
        duration: z.number().min(15).max(480), // Match duration validation
        targetEmail: z.string().email().max(254), // Match email validation
        purpose: z.string().optional(),
        preferredTimeframe: z.string().optional(),
        location: z.string().optional(),
        meetingLink: z.string().url().optional()
      });
     
      const validatedMeeting = meetingSchema.parse(parsed);
      
      // Structure data to match Gmail router expectations
      const meetingData = {
        title: validatedMeeting.title,
        duration: validatedMeeting.duration,
        targetEmail: validatedMeeting.targetEmail,
        purpose: validatedMeeting.purpose || undefined, // Use undefined instead of empty string
        preferredTimeframe: validatedMeeting.preferredTimeframe || undefined, // Use undefined instead of default
        location: validatedMeeting.location || undefined, // Use undefined instead of null
        meetingLink: validatedMeeting.meetingLink || undefined // Use undefined instead of null
      };
     
      return res.status(200).json({
        isMeeting: true,
        meeting: meetingData
      });
     
    } catch (e) {
      console.error('Error parsing JSON from OpenAI response:', rawContent);
      return res.status(200).json({
        isMeeting: false,
        message: rawContent.trim()
      });
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during OpenAI meeting extraction:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
openaiRouter.post('/extract-task', async (req: Request, res: Response) => {
  try {
    const { message } = userInputSchema.parse(req.body);
    const {systemPrompt}=req.body
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
// openaiRouter.post('/extract-gmail-jobs', async (req: Request, res: Response) => {
//   try {
//     const gmailDataSchema = z.array(z.object({
//       id: z.string(),
//       subject: z.string(),
//       snippet: z.string(),
//       fromEmail: z.string(),
//       cleanedJobInfo: z.string().optional(),
//       extractedJobData: z.object({
//         role: z.string().optional(),
//         company: z.string().optional(),
//         location: z.string().optional(),
//         appliedDate: z.string().optional(),
//         platform: z.string().optional()
//       }).optional(),
//       emailDate: z.string().optional(),
//       pdfAttachmentNames: z.array(z.string()).optional(),
//       internalDate: z.string().optional()
//     }));

//     const gmailData = gmailDataSchema.parse(req.body);

//     // === Build System Prompt ===
//     const now = new Date();
//     const istDateTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
//     const currentDateTime = istDateTime.toISOString().slice(0, 16);

//     const systemPrompt = `
// You are an intelligent assistant that analyzes Gmail content to extract job application information.

// Your task is to:
// 1. Identify only those emails that are directly related to the user's job applications — such as application confirmations, interview invitations, rejections, or offers.
// 2. Ignore general job updates, newsletters, job alerts, marketing emails, or non-application-specific messages.
// 3. Extract company names, job roles, application dates, and determine application status for valid application-related emails only.
// 4. Identify the platform/source from the fromEmail field.

// **Current date and time (IST timezone): ${currentDateTime}**

// Platform Detection Rules (based on fromEmail):
// - If fromEmail contains "linkedin.com" → "LinkedIn"
// - If fromEmail contains "indeed.com" → "Indeed" 
// - If fromEmail contains "naukri.com" → "Naukri"
// - If fromEmail contains "glassdoor.com" → "Glassdoor"
// - If fromEmail contains "superset" → "Superset"
// - If it's a direct company email (e.g., careers@company.com) → "Company Website"
// - If email suggests referral → "Referral"
// - Otherwise → "Other"

// Job Application Statuses:
// - "APPLIED": Application submitted/confirmed
// - "INTERVIEW": Interview invitation received, interview scheduled, or interview completed
// - "REJECTED": Application rejected, position filled, or not selected
// - "OFFER": Job offer received, offer letter
// - "WITHDRAWN": Application withdrawn by candidate

// Only include emails where the user has **actually applied** and there's a clear indication of:
// - an application submission,
// - an interview invitation,
// - a rejection notice,
// - an offer letter,
// - or withdrawal confirmation.

// Exclude:
// - generic job alerts,
// - platform newsletters,
// - unread job postings,
// - or any non-specific marketing/job promotion emails.

// For each qualifying email, return **only** a JSON array in this exact format:
// [
//   {
//     "sourceEmailId": "email_id",
//     "isJobRelated": true,
//     "companyName": "extracted_company_name or null",
//     "role": "extracted_job_role/title or null", 
//     "platform": "platform_name_string",
//     "status": "status_enum_value",
//     "appliedDate": "YYYY-MM-DDTHH:MM:SS.000Z or null",
//     "notes": "brief_summary_and_additional_context or null"
//   }
// ]

// Guidelines:
// - Use both pre-extracted data (extractedJobData) and email content for better accuracy.
// - Extract company names and job roles from subject, cleanedJobInfo, or email body.
// - Determine platform primarily from fromEmail domain.
// - Map email type to appropriate status based on context and content.
// - Use emailDate, internalDate, or extract from content for appliedDate.
// - If the email does **not** relate to an actual application, exclude it entirely from the result.
// - Notes should briefly explain what happened (e.g., "Interview scheduled for 12th Aug", "Application confirmed").

// Return exactly one JSON array with results for all valid application-related emails.
// `;

//     // === Construct Email Input Batch for LLM ===
//     const emailPrompt = gmailData.map((email, index) => {
//       return `Email ${index + 1}:
// ID: ${email.id}
// From: ${email.fromEmail}
// Subject: ${email.subject}
// Snippet: ${email.snippet}
// Cleaned Content: ${email.cleanedJobInfo || 'Not available'}
// Pre-extracted Data: ${email.extractedJobData ? JSON.stringify(email.extractedJobData) : 'None'}
// Email Date: ${email.emailDate || email.internalDate || 'Not provided'}
// Has Attachments: ${Array.isArray(email.pdfAttachmentNames) && email.pdfAttachmentNames.length ? 'Yes (' + email.pdfAttachmentNames.join(', ') + ')' : 'No'}

// ---`;
//     }).join('\n');

//     // === Call OpenAI ===
//     const response = await openai.chat.completions.create({
//       model: 'gpt-3.5-turbo',
//       messages: [
//         { role: 'system', content: systemPrompt },
//         { role: 'user', content: emailPrompt },
//       ],
//       temperature: 0.2,
//     });

//     const rawContent = response.choices[0].message.content;
//     console.log('Raw OpenAI Response:', rawContent?.slice(0, 500) + '...');

//     if (!rawContent) {
//       return res.status(500).json({ success: false, message: 'No response from AI.' });
//     }

//     // === Extract and Validate JSON ===
//     const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
//     if (!jsonMatch) {
//       return res.status(500).json({ success: false, message: 'AI response does not contain a JSON array.', rawResponse: rawContent });
//     }

//     let parsedResults;
//     try {
//       parsedResults = JSON.parse(jsonMatch[0]);
//     } catch (err:any) {
//       return res.status(500).json({ success: false, message: 'Failed to parse AI JSON', error: err.message, rawResponse: rawContent });
//     }

//     if (!Array.isArray(parsedResults)) {
//       return res.status(500).json({ success: false, message: 'AI response was not a valid array', rawResponse: rawContent });
//     }

//     // === Schema Validation ===
//     const jobApplicationSchema = z.object({
//       sourceEmailId: z.string(),
//       isJobRelated: z.boolean(),
//       companyName: z.string().nullable(),
//       role: z.string().nullable(),
//       platform: z.string(),
//       status: z.enum(['APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN']),
//       appliedDate: z.string().nullable(),
//       notes: z.string().nullable()
//     });

//     const validated = parsedResults.map((email, index) => {
//       try {
//         const parsed = jobApplicationSchema.parse(email);
//         if (parsed.appliedDate) {
//           try {
//             parsed.appliedDate = new Date(parsed.appliedDate).toISOString();
//           } catch {
//             parsed.appliedDate = null;
//           }
//         }
//         return parsed;
//       } catch (err) {
//         console.warn(`Validation failed for email ${index}`, err);
//         return null;
//       }
//     }).filter(Boolean);

//     // === Filter Valid Applications ===
//     const validApplications = validated.filter((app:any) => app.isJobRelated && app.companyName && app.role);

//     // === Transform for DB (optional) ===
//     const formatted = validApplications.map((app:any) => ({
//       platform: app.platform,
//       companyName: app.companyName!,
//       role: app.role!,
//       appliedDate: app.appliedDate ? new Date(app.appliedDate) : new Date(),
//       status: app.status,
//       sourceEmailId: app.sourceEmailId,
//       notes: app.notes,
//     }));

//     // === Return Response ===
//     return res.status(200).json({
//       success: true,
//       jobApplications: formatted,
//       allProcessedEmails: validated,
//       processingStats: {
//         totalProcessed: validated.length,
//         jobRelatedCount: validated.filter((e: any) => e.isJobRelated).length,
//         validJobApplications: validApplications.length,
//         failedToProcess: gmailData.length - validated.length
//       }
//     });

//   } catch (error: any) {
//     if (error.name === 'ZodError') {
//       return res.status(400).json({ success: false, message: 'Invalid input data', errors: error.errors });
//     }

//     console.error('Error during Gmail job extraction:', error);
//     return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
//   }
// });


export default openaiRouter;