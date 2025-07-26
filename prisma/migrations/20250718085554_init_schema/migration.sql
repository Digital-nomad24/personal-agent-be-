/*
  Warnings:

  - You are about to drop the column `calendarSyncEnabled` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "calendarSyncEnabled";

-- CreateTable
CREATE TABLE "CalendarChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "expiration" TIMESTAMP(3) NOT NULL,
    "token" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarChannel_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CalendarChannel" ADD CONSTRAINT "CalendarChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
