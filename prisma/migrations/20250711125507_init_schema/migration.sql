/*
  Warnings:

  - You are about to drop the column `telegraChatId` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "telegraChatId",
ADD COLUMN     "telegramChatId" TEXT;
