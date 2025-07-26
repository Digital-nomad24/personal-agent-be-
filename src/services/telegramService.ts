import axios from "axios";
import prisma from "../utils/prisma";
const userToChatIdMap = new Map<string, string>();

export async function getTelegramChatIdForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });

  return user?.telegramChatId || null;
}

export async function sendTelegramMessage(chatId: string, message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text: message
  });
}
