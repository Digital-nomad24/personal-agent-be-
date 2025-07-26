// import { Router } from 'express';
// import bcrypt from 'bcrypt';
// import axios from 'axios';
// import prisma from '../utils/prisma';
// import dotenv from 'dotenv';
// import {generateToken} from './auth';
// dotenv.config();

// const telegramRouter = Router();
// const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
// const REMINDER_API_URL = 'http://localhost:8000/api/v1/openai/extract-task'

// if (!TELEGRAM_BOT_TOKEN) {
//   console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is not defined in environment variables.");
//   process.exit(1);
// }

// // Helper function to send Telegram messages
// const sendTelegramMessage = async (chatId: number, text: string) => {
//   try {
//     await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
//       chat_id: chatId,
//       text: text
//     });
//   } catch (error) {
//     console.error("Failed to send Telegram message:", error);
//   }
// };

// telegramRouter.post('/webhook', async (req, res) => {
//   const message = req.body.message;
//   console.log("👉 Telegram Webhook Triggered");
//   console.log("📨 Message Text:", message?.text);
  
//   if (!message || !message.chat || !message.text) {
//     return res.status(200).send("Ignored: Incomplete message");
//   }
  
//   const chatId = message.chat.id;
//   const fullText = message.text.trim();
//   const parts = fullText.split(" ");
//   const command = parts[0].toLowerCase();
  
//   // Handle /remind command
//   if (command === "/remind") {
//     try {
//       // Check if user is authenticated
//       const user = await prisma.user.findFirst({
//         where: { telegramChatId: String(chatId) },
//         select: {
//           id: true,
//           email: true,
//           name: true,
//           telegramChatId: true
//         }
//       });
      
//       if (!user) {
//         await sendTelegramMessage(chatId, 
//           '🔐 **Authentication Required**\n\n' +
//           'You need to connect your account first before using reminders.\n\n' +
//           '**Connection Commands:**\n' +
//           '• For Google users: `/start [your_email]`\n' +
//           '• For password users: `/start [your_email] [your_password]`\n\n' +
//           '**Examples:**\n' +
//           '• `/start john@gmail.com`\n' +
//           '• `/start john@example.com mypassword123`\n\n' +
//           '✨ Once connected, you can use `/remind` to set reminders!'
//         );
//         return res.status(200).send("User not authenticated for reminder");
//       }
      
//       // Get the reminder message (everything after /remind)
//       const reminderMessage = fullText.replace(/^\/remind\s+/i, '').trim();
      
//       if (!reminderMessage) {
//         await sendTelegramMessage(chatId,
//           '⚠️ **No reminder message provided**\n\n' +
//           '**Example:** `/remind Call mom tomorrow`'
//         );
//         return res.status(200).send("No reminder message");
//       }
      
//       // Prepare the payload for your API
//       const reminderPayload = {
//         userId: user.id,
//         message: reminderMessage,
//         telegramChatId: chatId,
//         userEmail: user.email,
//         userName: user.name,
//         timestamp: new Date().toISOString()
//       };
      
//       console.log("🔄 Sending reminder to API:", reminderPayload);
      
//       // Send to your reminder API
//       try {
//         const response = await axios.post(REMINDER_API_URL, reminderPayload, {
//           headers: {
//             'Content-Type': 'application/json',
//             'User-Agent': 'TelegramReminderBot/1.0'
//           },
//           timeout: 30000 
//         });
        
//         console.log("✅ Reminder sent to API successfully:", response.data);
//         const taskData = response.data.task;
        
//         if (!taskData || !taskData.title || !taskData.priority) {
//           throw new Error("Incomplete response from assistant");
//         }
        
//         const token = generateToken(user.id);

//         await axios.post('http://localhost:8000/api/v1/tasks',
//           {
//             title: taskData.title,
//             priority: taskData.priority.toLowerCase(),
//             status: 'pending',
//             dueDate: taskData.dueDate || null,
//           },
//           {
//             headers: {
//               'Content-Type': 'application/json',
//               'Authorization': `Bearer ${token}`
//             }
//           }
//         );
        
//         await sendTelegramMessage(chatId, 
//           `✅ **Reminder Set Successfully!**\n\n` +
//           `📝 **Task:** ${taskData.title}\n` +
//           `⚡ **Priority:** ${taskData.priority}\n` +
//           `📅 **Due Date:** ${taskData.dueDate || 'Not specified'}`
//         );
        
//       } catch (apiError: any) {
//         console.error("❌ Error with reminder API:", apiError.response?.data || apiError.message);
        
//         await sendTelegramMessage(chatId,
//           '❌ **Failed to Set Reminder**\n\n' +
//           'Something went wrong. Please try again later.'
//         );
//       }
      
//       return res.status(200).send("Reminder command processed");
      
//     } catch (error) {
//       console.error("❌ Error processing reminder:", error);
      
//       await sendTelegramMessage(chatId,
//         '❌ **System Error**\n\n' +
//         'Something went wrong processing your reminder. Please try again.'
//       );
      
//       return res.status(200).send("Error in reminder processing");
//     }
//   }
  
//   // Handle /help command
//   if (command === "/help") {
//     try {
//       const user = await prisma.user.findFirst({
//         where: { telegramChatId: String(chatId) },
//         select: { name: true, email: true }
//       });
      
//       let helpText = '📚 **Reminder Bot Help**\n\n';
      
//       if (user) {
//         helpText += `👤 **Connected as:** ${user.name} (${user.email})\n\n`;
//         helpText += '**Available Commands:**\n' +
//                    '• `/remind [message]` - Set a reminder\n' +
//                    '• `/help` - Show this help message\n' +
//                    '• `/start [email] [password]` - Reconnect account\n\n' +
//                    '**Reminder Examples:**\n' +
//                    '• `/remind Call mom tomorrow`\n' +
//                    '• `/remind Buy groceries`\n' +
//                    '• `/remind Team meeting at 3pm`';
//       } else {
//         helpText += '**First, connect your account:**\n' +
//                    '• For Google users: `/start [your_email]`\n' +
//                    '• For password users: `/start [your_email] [your_password]`\n\n' +
//                    '**Examples:**\n' +
//                    '• `/start john@gmail.com`\n' +
//                    '• `/start john@example.com mypassword123`\n\n' +
//                    '✨ After connecting, you can use `/remind` to set reminders!';
//       }
      
//       await sendTelegramMessage(chatId, helpText);
//       return res.status(200).send("Help command processed");
      
//     } catch (error) {
//       console.error("Error in help command:", error);
//       await sendTelegramMessage(chatId, '❌ Error displaying help. Please try again.');
//       return res.status(200).send("Error in help command");
//     }
//   }
  
//   // Handle /start command
//   if (command === "/start") {
//     // Check if it's email-only format (for Google users) or email+password format
//     if (parts.length < 2) {
//       await sendTelegramMessage(chatId,
//         '⚠️ **Missing Email Address**\n\n' +
//         '**Connection Formats:**\n' +
//         '• For Google users: `/start [your_email]`\n' +
//         '• For password users: `/start [your_email] [your_password]`\n\n' +
//         '**Examples:**\n' +
//         '• `/start john@gmail.com`\n' +
//         '• `/start john@example.com mypassword123`'
//       );
//       return res.status(200).send("Handled /start with missing email");
//     }
    
//     const email = parts[1];
//     const password = parts.length > 2 ? parts.slice(2).join(" ") : null;
    
//     try {
//       const user = await prisma.user.findUnique({
//         where: { email: email },
//         select: {
//           id: true,
//           email: true,
//           name: true,
//           password: true,
//           provider: true,
//           telegramChatId: true
//         }
//       });
      
//       if (!user) {
//         await sendTelegramMessage(chatId,
//           '❌ **Account Not Found**\n\n' +
//           'No account found with this email address. Please check your email and try again.'
//         );
//         return res.status(200).send("User not found");
//       }
      
//       if (user.provider === 'google' || !user.password) {
//         if (password) {
//           await sendTelegramMessage(chatId,
//             '⚠️ **Google Account Detected**\n\n' +
//             'This account uses Google sign-in and doesn\'t require a password.\n\n' +
//             `**Please use:** \`/start ${email}\``
//           );
//           return res.status(200).send("Google user provided password");
//         }
        
//         console.log(`🔐 Google user ${email} attempting Telegram connection`);
        
//       } else {
//         if (!password) {
//           await sendTelegramMessage(chatId,
//             '⚠️ **Password Required**\n\n' +
//             'This account requires a password.\n\n' +
//             '**Please use:** `/start [your_email] [your_password]`'
//           );
//           return res.status(200).send("Password required for local user");
//         }
        
//         const isPasswordValid = await bcrypt.compare(password, user.password);
        
//         if (!isPasswordValid) {
//           await sendTelegramMessage(chatId,
//             '❌ **Invalid Password**\n\n' +
//             'Please check your password and try again.'
//           );
//           return res.status(200).send("Invalid password provided");
//         }
//       }
      
//       if (user.telegramChatId && user.telegramChatId !== String(chatId)) {
//         await sendTelegramMessage(chatId,
//           '⚠️ **Account Already Connected**\n\n' +
//           'This account is already connected to another Telegram chat. Contact support if you need to change this.'
//         );
//         return res.status(200).send("Account already connected to different chat");
//       }
      
//       await prisma.user.update({
//         where: { id: user.id },
//         data: { telegramChatId: String(chatId) },
//       });
      
//       const authMethodText = user.provider === 'google' ? '(Google Account)' : '(Password Account)';
//       await sendTelegramMessage(chatId,
//         `✅ **Account Connected Successfully!**\n\n` +
//         `👤 **User:** ${user.name} ${authMethodText}\n` +
//         `📧 **Email:** ${user.email}\n` +
//         `🔔 **Status:** You'll now receive reminders here\n\n` +
//         `🚀 **Ready to Use:**\n` +
//         `• Use \`/remind [message]\` to set reminders\n` +
//         `• Use \`/help\` for more information\n\n` +
//         `💡 **Quick Examples:**\n` +
//         `• \`/remind Call mom tomorrow\`\n` +
//         `• \`/remind Buy groceries\`\n` +
//         `• \`/remind Team meeting at 3pm\``
//       );
      
//       console.log(`✅ User ${user.email} (${user.provider}) connected to Telegram chat ${chatId}`);
//       return res.status(200).send("Telegram linked successfully");
      
//     } catch (err) {
//       console.error("❌ Error in Telegram webhook:", err);
      
//       await sendTelegramMessage(chatId,
//         '❌ **System Error**\n\n' +
//         'Something went wrong. Please try again later.'
//       );
      
//       return res.status(200).send("Error occurred, but acknowledged");
//     }
//   }
  
//   // Handle unknown commands
//   await sendTelegramMessage(chatId,
//     '❓ **Unknown Command**\n\n' +
//     'Available commands:\n' +
//     '• `/start` - Connect your account\n' +
//     '• `/remind` - Set a reminder\n' +
//     '• `/help` - Show help'
//   );
  
//   return res.status(200).send("Unknown command handled");
// });

// export default telegramRouter;