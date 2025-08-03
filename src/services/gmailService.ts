import { google } from 'googleapis';
import { getValidAccessToken } from '../routes/google';
import prisma from '../utils/prisma';

interface CalendarAccessEmailData {
  targetEmail: string;
  targetName: string;
  requesterName: string;
  requesterEmail: string;
  meetingTitle: string;
  meetingPurpose: string;
  duration: number;
  preferredTimeframe: string;
  approvalLink: string;
  expiresAt: string;
}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_APPROVAL_REDIRECT_URI,
} = process.env;

// Only Gmail API approach remains
async function sendEmailViaGmailAPI(userId: string, data: CalendarAccessEmailData) {
  try {
    const accessToken = await getValidAccessToken(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new Error("User email not found");

    const oAuth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_APPROVAL_REDIRECT_URI
    );

    oAuth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: user.googleRefreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const htmlContent = generateEmailHTML(data);
    const textContent = generateEmailText(data);

    // Create the email message
    const message = [
      `From: "Calendar Meeting Assistant" <${user.email}>`,
      `To: ${data.targetEmail}`,
      `Subject:  Meeting Request: ${data.meetingTitle} from ${data.requesterName}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="boundary123"',
      '',
      '--boundary123',
      'Content-Type: text/plain; charset=utf-8',
      '',
      textContent,
      '',
      '--boundary123',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlContent,
      '',
      '--boundary123--'
    ].join('\n');

    // Encode the message
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log('✅ Email sent via Gmail API:', result.data.id);
    return result.data;

  } catch (error) {
    console.error('❌ Error sending via Gmail API:', error);
    throw error;
  }
}

function generateEmailHTML(data: CalendarAccessEmailData): string {
  const {
    targetName,
    requesterName,
    requesterEmail,
    meetingTitle,
    meetingPurpose,
    duration,
    preferredTimeframe,
    approvalLink,
    expiresAt
  } = data;

  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Meeting Request - Calendar Access</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
        .meeting-details { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea; }
        .cta-button { display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
        .cta-button:hover { background: #218838; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 14px; color: #6c757d; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 6px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📅 Meeting Request</h1>
        <p>Someone wants to schedule a meeting with you</p>
      </div>
      
      <div class="content">
        <p>Hi ${targetName},</p>
        
        <p><strong>${requesterName}</strong> (${requesterEmail}) has requested to schedule a meeting with you.</p>
        
        <div class="meeting-details">
          <h3>📋 Meeting Details</h3>
          <p><strong>Title:</strong> ${meetingTitle}</p>
          <p><strong>Purpose:</strong> ${meetingPurpose}</p>
          <p><strong>Duration:</strong> ${duration} minutes</p>
          <p><strong>Preferred Timeframe:</strong> ${preferredTimeframe}</p>
        </div>
        
        <p>To proceed with this meeting request, we need your permission to access your calendar availability. This will allow us to:</p>
        
        <ul>
          <li>✅ Check your free/busy times</li>
          <li>✅ Suggest available meeting slots</li>
          <li>✅ Create the meeting once you confirm</li>
        </ul>
        
        <div style="text-align: center;">
          <a href="${approvalLink}" class="cta-button">
            🔓 Grant Calendar Access & View Available Times
          </a>
        </div>
        
        <div class="warning">
          <strong>⏰ This request expires on ${expiryDate}</strong><br>
          Please respond before the expiration date to proceed with scheduling.
        </div>
        
        <p>If you don't recognize this request or prefer not to schedule this meeting, you can simply ignore this email.</p>
        
        <div class="footer">
          <p>This email was sent because ${requesterName} requested a meeting with your calendar (${data.targetEmail}).</p>
          <p>No calendar access will be granted unless you click the approval button above.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateEmailText(data: CalendarAccessEmailData): string {
  const {
    targetName,
    requesterName,
    requesterEmail,
    meetingTitle,
    meetingPurpose,
    duration,
    preferredTimeframe,
    approvalLink,
    expiresAt
  } = data;

  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
Meeting Request - Calendar Access Required

Hi ${targetName},

${requesterName} (${requesterEmail}) has requested to schedule a meeting with you.

Meeting Details:
- Title: ${meetingTitle}
- Purpose: ${meetingPurpose}
- Duration: ${duration} minutes
- Preferred Timeframe: ${preferredTimeframe}

To proceed with this meeting request, please grant calendar access by visiting:
${approvalLink}

This request expires on ${expiryDate}.

If you don't recognize this request, you can ignore this email.
  `;
}

// Exported main function (now only uses Gmail API)
export async function sendCalendarAccessEmail(userId: string, data: CalendarAccessEmailData) {
  console.log('📧 Starting to send calendar access email using Gmail API ');
  try {
    const result = await sendEmailViaGmailAPI(userId, data);
    console.log('✅ Email sent successfully via Gmail API');
    return result;
  } catch (gmailApiError: any) {
    console.error('❌ Gmail API failed:', gmailApiError);
    throw new Error(`Email sending failed: ${gmailApiError.message}`);
  }
}
