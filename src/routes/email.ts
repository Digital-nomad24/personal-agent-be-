// Add these imports at the top of your file
import { google } from 'googleapis';
import { Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import prisma from '../utils/prisma';
import { getValidAccessToken } from './google';
export const emailRouter=Router()
function extractEmailBody(payload: any): string {
  if (!payload) return '';
  
  let body = '';
  
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
        if (part.body?.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.parts) {
        body += extractEmailBody(part);
      }
    }
  } else if (payload.body?.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  
  return body;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// === SEARCH JOB EMAILS ENDPOINT ===
emailRouter.post('/search-job-emails', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  
  try {
    const { 
      queries,           // Optional: Array of custom queries
      days = 30,         // Search last 30 days for job applications
      maxResults = 50,   // Total max results across all queries
      maxResultsPerQuery = 10  // Max results per individual query
    } = req.body;

    const accessToken = await getValidAccessToken(userId);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth });

    const defaultJobQueries = [
      { name: 'LinkedIn Applications', query: 'from:linkedin.com (applied OR application OR thank you)' },
      { name: 'Indeed Applications', query: 'from:indeed.com (applied OR application OR thank you)' },
      { name: 'Naukri Applications', query: 'from:naukri.com (applied OR application OR thank you)' },
      { name: 'Glassdoor Applications', query: 'from:glassdoor.com (applied OR application OR thank you)' },
      { name: 'General Job Applications', query: '(job application OR application received OR interview OR offer OR rejection)' },
      { name: 'Career Emails', query: '(careers@ OR hiring@ OR hr@ OR recruiter)' },
      { name: 'Job Subject Lines', query: 'subject:(interview OR offer OR rejection OR application OR position OR job)' }
    ];

    // Use custom queries if provided, otherwise use defaults
    const queriesToProcess = queries && Array.isArray(queries) && queries.length > 0 
      ? queries 
      : defaultJobQueries;
    console.log(`Processing ${queriesToProcess.length} queries (${queries ? 'custom' : 'default'})`);

    const allEmails = [];
    const processedIds = new Set(); // Avoid duplicates
    const queryResults = [];

    for (const queryObj of queriesToProcess) {
      const { name, query } = queryObj;
      const fullQuery = `is:unread ${query} newer_than:${days}d`;
      
      try {
        console.log(`Processing query "${name}": ${fullQuery}`);
        
        const { data: list } = await gmail.users.messages.list({
  userId: 'me',
  q: fullQuery,
  maxResults: maxResultsPerQuery,
});

const messageIds = list.messages
  ?.map(msg => msg.id)
  .filter((id): id is string => id != null) || [];

if (messageIds.length > 0) {
  try {
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: messageIds,
        removeLabelIds: ['UNREAD']
      }
    });
    console.log(`Marked ${messageIds.length} emails as read`);
  } catch (error) {
    console.error('Error marking emails as read:', error);
  }
}

        const messages = list.messages || [];
        
        // Get lean metadata for messages
        const emailData = await Promise.all(
          messages.map(async (msg) => {
            if (processedIds.has(msg.id!)) return null; // Skip duplicates
            processedIds.add(msg.id!);
            
            try {
              const { data: msgDetail } = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date', 'To']
              });

              const headers = msgDetail.payload?.headers || [];
              const getHeader = (name: string) => 
                headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

              const fromEmail = getHeader('From');
              const subject = getHeader('Subject');

              return {
                id: msg.id,
                subject: subject,
                fromEmail: fromEmail,
                snippet: msgDetail.snippet || '',
                internalDate: msgDetail.internalDate ? 
                  new Date(parseInt(msgDetail.internalDate)).toISOString() : null,
                emailDate: getHeader('Date')
              };
            } catch (error) {
              console.error(`Error fetching email ${msg.id}:`, error);
              return null;
            }
          })
        );

        const validEmails = emailData.filter(email => email !== null);
        allEmails.push(...validEmails);

        queryResults.push({
          queryName: name,
          query: fullQuery,
          totalFound: messages.length,
          processed: validEmails.length
        });

      } catch (error: any) {
        console.error(`Error with query "${name}":`, error);
        queryResults.push({
          queryName: name,
          query: fullQuery,
          error: error.message,
          totalFound: 0,
          processed: 0
        });
      }
    }

    // Remove duplicates and limit results
    const uniqueEmails = Array.from(
      new Map(allEmails.map(email => [email.id, email])).values()
    ).slice(0, maxResults);

    return res.json({
      success: true,
      message: `Found ${uniqueEmails.length} potential job-related emails using ${queries ? 'custom' : 'default'} queries`,
      emails: uniqueEmails,
      queryResults: queryResults,
      summary: {
        totalQueries: queriesToProcess.length,
        totalEmailsFound: uniqueEmails.length,
        successful: queryResults.filter(r => !r.error).length,
        failed: queryResults.filter(r => r.error).length,
        usingCustomQueries: !!queries
      }
    });

  } catch (error: any) {
    console.error('Error searching job emails:', error);
    return res.status(500).json({
      success: false,
      message: 'Error searching job emails',
      error: error.message
    });
  }
});

// === COMPLETE JOB APPLICATION EXTRACTION PIPELINE ===
emailRouter.post('/extract-job-applications', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  
  try {
    const { 
      queries,           
      days = 10, 
      maxResults = 50,
      maxResultsPerQuery = 10 
    } = req.body;

    const accessToken = await getValidAccessToken(userId);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth });

    // Default optimized job-related queries
    const defaultJobQueries = [
      { name: 'LinkedIn Applications', query: 'from:linkedin.com (applied OR application OR thank you)' },
      { name: 'Indeed Applications', query: 'from:indeed.com (applied OR application OR thank you)' },
      { name: 'Naukri Applications', query: 'from:naukri.com (applied OR application OR thank you)' },
      { name: 'Glassdoor Applications', query: 'from:glassdoor.com (applied OR application OR thank you)' },
      { name: 'General Job Applications', query: '(job application OR application received OR interview OR offer OR rejection)' },
      { name: 'Career Emails', query: '(careers@ OR hiring@ OR hr@ OR recruiter)' },
      { name: 'Job Subject Lines', query: 'subject:(interview OR offer OR rejection OR application OR position OR job)' }
    ];

    // Use custom queries if provided, otherwise use defaults
    const queriesToProcess = queries && Array.isArray(queries) && queries.length > 0 
      ? queries 
      : defaultJobQueries;

    console.log(`Processing ${queriesToProcess.length} queries for extraction pipeline`);

    const allEmails = [];
    const processedIds = new Set();

    for (const queryObj of queriesToProcess) {
      const { name, query } = queryObj;
      const fullQuery = `${query} newer_than:${days}d`;
      
      try {
        console.log(`Processing query "${name}": ${fullQuery}`);
        
        const { data: list } = await gmail.users.messages.list({
          userId: 'me',
          q: fullQuery,
          maxResults: maxResultsPerQuery,
        });

        const messages = list.messages || [];
        
        // Get lean metadata for messages
        const emailData = await Promise.all(
          messages.map(async (msg) => {
            if (processedIds.has(msg.id!)) return null;
            processedIds.add(msg.id!);
            
            try {
              const { data: msgDetail } = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date', 'To']
              });

              const headers = msgDetail.payload?.headers || [];
              const getHeader = (name: string) => 
                headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

              return {
                id: msg.id,
                subject: getHeader('Subject'),
                fromEmail: getHeader('From'),
                snippet: msgDetail.snippet || '',
                internalDate: msgDetail.internalDate ? 
                  new Date(parseInt(msgDetail.internalDate)).toISOString() : null,
                emailDate: getHeader('Date')
              };
            } catch (error) {
              console.error(`Error fetching email ${msg.id}:`, error);
              return null;
            }
          })
        );

        allEmails.push(...emailData.filter(email => email !== null));

      } catch (error: any) {
        console.error(`Error with query "${name}":`, error);
      }
    }

    // Remove duplicates and limit results
    const emails = Array.from(
      new Map(allEmails.map(email => [email.id, email])).values()
    ).slice(0, maxResults);

    console.log(`Found ${emails.length} emails for AI processing`);

    if (!emails || emails.length === 0) {
      return res.json({
        success: true,
        message: 'No job-related emails found',
        jobApplications: [],
        stats: { totalProcessed: 0, extracted: 0, needsDetailedFetch: 0 }
      });
    }

    // Step 2: Process emails through OpenAI (first pass with lean data)
    // Fix: Use consistent API URL and proper error handling
    const openaiApiUrl = 'http://localhost:8000';
    const aiResponse = await fetch(`${openaiApiUrl}/api/v1/openai/extract-gmail-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_TOKEN || ''}` // Add auth if needed
      },
      body: JSON.stringify(emails)
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API Error:', errorText);
      throw new Error(`Failed to process emails through AI: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    let jobApplications = aiData.jobApplications || [];
    let incompleteEmails: string[] = [];

    // Step 3: Identify emails with missing critical data
    for (const email of aiData.allProcessedEmails || []) {
      if (email.isJobRelated && (!email.companyName || !email.role)) {
        incompleteEmails.push(email.sourceEmailId);
      }
    }

    console.log(`Found ${incompleteEmails.length} emails needing detailed fetch`);

    // Step 4: Fetch full content for incomplete emails and re-process
    if (incompleteEmails.length > 0) {
      const detailedEmails = [];
      
      for (const emailId of incompleteEmails) {
        try {
          // Direct internal call to get email details
          const { data: msgDetail } = await gmail.users.messages.get({
            userId: 'me',
            id: emailId,
            format: 'full'
          });

          // Extract all headers
          const headers = msgDetail.payload?.headers || [];
          const headerMap = headers.reduce((acc, header) => {
            if (header.name && header.value) {
              acc[header.name] = header.value;
            }
            return acc;
          }, {} as Record<string, string>);

          // Extract body
          const rawBody = extractEmailBody(msgDetail.payload);
          const cleanBody = stripHtml(rawBody);
          
          detailedEmails.push({
            id: emailId,
            subject: headerMap.Subject || '',
            fromEmail: headerMap.From || '',
            snippet: msgDetail.snippet || '',
            cleanedJobInfo: cleanBody.substring(0, 3000), // Limit content
            internalDate: msgDetail.internalDate ? 
              new Date(parseInt(msgDetail.internalDate)).toISOString() : null,
            emailDate: headerMap.Date
          });

        } catch (error) {
          console.error(`Failed to fetch detailed content for email ${emailId}:`, error);
        }
      }

      // Re-process detailed emails through OpenAI
      if (detailedEmails.length > 0) {
        try {
          const detailedAiResponse = await fetch(`${openaiApiUrl}/api/v1/openai/extract-gmail-jobs`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.API_TOKEN || ''}`
            },
            body: JSON.stringify(detailedEmails)
            
          });
          console.log(JSON.stringify(detailedEmails))
          if (detailedAiResponse.ok) {
            const detailedAiData = await detailedAiResponse.json();
            const additionalApplications = detailedAiData.jobApplications || [];
            
            // Merge results - remove incomplete ones and add detailed ones
            jobApplications = jobApplications.filter((app: any) => 
              !incompleteEmails.includes(app.sourceEmailId)
            );
            jobApplications.push(...additionalApplications);
          } else {
            console.error('Failed to process detailed emails through AI:', await detailedAiResponse.text());
          }
        } catch (error) {
          console.error('Error processing detailed emails:', error);
        }
      }
    }

    // Step 5: Save to database
    let savedCount = 0;
    if (jobApplications.length > 0) {
      try {
        // Check for existing applications to avoid duplicates
        const existingApplications = await prisma.jobApplication.findMany({
          where: {
            userId: userId,
            sourceEmailId: {
              in: jobApplications.map((app: any) => app.sourceEmailId || app.companyName )
            }
          },
          select: { sourceEmailId: true }
        });

        const existingIds = new Set(existingApplications.map(app => app.sourceEmailId));
        const newApplications = jobApplications.filter((app: any) => 
          !existingIds.has(app.sourceEmailId)
        );

        if (newApplications.length > 0) {
          const savedApplications = await prisma.jobApplication.createMany({
            data: newApplications.map((app: any) => ({
              userId: userId,
              platform: app.platform,
              companyName: app.companyName,
              role: app.role,
              appliedDate: app.appliedDate ? new Date(app.appliedDate) : new Date(),
              status: app.status,
              sourceEmailId: app.sourceEmailId,
              notes: app.notes,
            })),
            skipDuplicates: true
          });

          savedCount = savedApplications.count;
          console.log(`Saved ${savedCount} new job applications to database`);
        } else {
          console.log('No new applications to save (all already exist)');
        }
      } catch (dbError) {
        console.error('Error saving to database:', dbError);
        // Continue without throwing - we still have the extracted data
      }
    }

    return res.json({
      success: true,
      message: `Successfully extracted ${jobApplications.length} job applications`,
      jobApplications: jobApplications,
      stats: {
        totalEmailsFound: emails.length,
        totalProcessed: aiData.processingStats?.totalProcessed || 0,
        jobRelatedCount: aiData.processingStats?.jobRelatedCount || 0,
        extracted: jobApplications.length,
        needsDetailedFetch: incompleteEmails.length,
        savedToDatabase: savedCount
      }
    });

  } catch (error: any) {
    console.error('Error in job application extraction pipeline:', error);
    return res.status(500).json({
      success: false,
      message: 'Error extracting job applications',
      error: error.message
    });
  }
});

// === UTILITY: UPDATE JOB APPLICATION STATUS ===
emailRouter.put('/job-application/:id/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { id } = req.params;
  const { status, notes } = req.body;

  try {
    const validStatuses = ['APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value',
        validStatuses
      });
    }

    const updatedApplication = await prisma.jobApplication.update({
      where: {
        id: id,
        userId: userId // Ensure user can only update their own applications
      },
      data: {
        status: status,
        notes: notes || undefined,
        updatedAt: new Date()
      }
    });

    return res.json({
      success: true,
      message: 'Job application status updated',
      application: updatedApplication
    });

  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Job application not found'
      });
    }
    
    console.error('Error updating job application:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating job application',
      error: error.message
    });
  }
});

// === GET USER'S JOB APPLICATIONS ===
emailRouter.get('/job-applications', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { status, company, limit = '50', offset = '0' } = req.query;

  try {
    const where: any = { userId };
    
    if (status && typeof status === 'string') {
      where.status = status;
    }
    
    if (company && typeof company === 'string') {
      where.companyName = {
        contains: company,
        mode: 'insensitive'
      };
    }

    const limitNum = parseInt(limit as string) || 50;
    const offsetNum = parseInt(offset as string) || 0;

    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: [
        { updatedAt: 'desc' }, // Fix: Use lastStatusUpdate for better ordering
        { appliedDate: 'desc' }
      ],
      take: limitNum,
      skip: offsetNum
    });

    const total = await prisma.jobApplication.count({ where });

    return res.json({
      success: true,
      applications,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: total > offsetNum + applications.length
      }
    });

  } catch (error: any) {
    console.error('Error fetching job applications:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching job applications',
      error: error.message
    });
  }
});
