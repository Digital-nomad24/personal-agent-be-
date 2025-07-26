/*
  Warnings:

  - Added the required column `availableEnd` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `availableStart` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `earliestHour` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `latestHour` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slotDuration` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timezone` to the `CalendarShareLink` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CalendarShareLink" ADD COLUMN     "allowBookingEdit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowWeekends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "availableEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "availableStart" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "bufferBetween" INTEGER,
ADD COLUMN     "earliestHour" INTEGER NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "latestHour" INTEGER NOT NULL,
ADD COLUMN     "slotDuration" INTEGER NOT NULL,
ADD COLUMN     "timezone" TEXT NOT NULL;
