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
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Meeting Request - Calendar Access</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #333;
          margin: 0;
          padding: 0;
          background-color: #f4f6f8;
        }
        .container {
          max-width: 640px;
          margin: 0 auto;
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 2px 10px rgba(0,0,0,0.06);
        }
        .header {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          padding: 30px 20px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
        }
        .header p {
          margin-top: 6px;
          font-size: 16px;
          opacity: 0.9;
        }
        .content {
          padding: 25px 20px 30px;
        }
        .content p {
          margin: 0 0 15px;
          font-size: 15px;
          line-height: 1.6;
        }
        .meeting-details {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        .meeting-details th,
        .meeting-details td {
          padding: 10px 12px;
          text-align: left;
          border-bottom: 1px solid #eee;
          font-size: 14px;
        }
        .meeting-details th {
          background-color: #f9f9fb;
          font-weight: 600;
        }
        .cta-wrapper {
          text-align: center;
          margin: 25px 0;
        }
        .cta-button {
          background-color: #28a745;
          color: white !important;
          padding: 14px 28px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
          font-size: 15px;
          display: inline-block;
          transition: background-color 0.2s ease;
        }
        .cta-button:hover {
          background-color: #218838;
        }
        .warning {
          background: #fff9e6;
          border-left: 4px solid #ffcc00;
          padding: 12px 15px;
          font-size: 14px;
          margin-top: 20px;
          border-radius: 6px;
        }
        .footer {
          font-size: 13px;
          color: #6c757d;
          margin-top: 25px;
          border-top: 1px solid #eee;
          padding-top: 15px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 Meeting Request</h1>
          <p>Someone wants to schedule a meeting with you</p>
        </div>
        <div class="content">
          <p>Hi ${targetName},</p>
          <p><strong>${requesterName}</strong> (${requesterEmail}) has requested to schedule a meeting with you.</p>

          <table class="meeting-details">
            <tr>
              <th>Title</th>
              <td>${meetingTitle}</td>
            </tr>
            <tr>
              <th>Purpose</th>
              <td>${meetingPurpose}</td>
            </tr>
            <tr>
              <th>Duration</th>
              <td>${duration} minutes</td>
            </tr>
            <tr>
              <th>Preferred Timeframe</th>
              <td>${preferredTimeframe}</td>
            </tr>
          </table>

          <p>To proceed with this request, we need your permission to access your calendar availability so we can:</p>
          <ul>
            <li>✅ Check your free/busy times</li>
            <li>✅ Suggest available meeting slots</li>
            <li>✅ Create the meeting once you confirm</li>
          </ul>

          <div class="cta-wrapper">
            <a href="${approvalLink}" class="cta-button">
              🔓 Grant Calendar Access & View Times
            </a>
          </div>

          <div class="warning">
            ⏰ This request expires on <strong>${expiryDate}</strong>. Please respond before then to proceed with scheduling.
          </div>

          <p>If you don't recognize this request, you can safely ignore this email.</p>

          <div class="footer">
            <p>This email was sent because ${requesterName} requested a meeting with your calendar (${data.targetEmail}).</p>
            <p>No calendar access will be granted unless you click the approval button above.</p>
          </div>
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
