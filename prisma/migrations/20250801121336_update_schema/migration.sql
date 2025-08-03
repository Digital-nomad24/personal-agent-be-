/*
  Warnings:

  - You are about to drop the `BillRecord` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CalendarChannel` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CalendarEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CalendarShareLink` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CustomDataPoint` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Group` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GroupMembership` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobApplication` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Meeting` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MeetingAttendee` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Notification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserMonitorPreference` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BillRecord" DROP CONSTRAINT "BillRecord_userId_fkey";

-- DropForeignKey
ALTER TABLE "CalendarChannel" DROP CONSTRAINT "CalendarChannel_userId_fkey";

-- DropForeignKey
ALTER TABLE "CalendarEvent" DROP CONSTRAINT "CalendarEvent_userId_fkey";

-- DropForeignKey
ALTER TABLE "CalendarShareLink" DROP CONSTRAINT "CalendarShareLink_userId_fkey";

-- DropForeignKey
ALTER TABLE "CustomDataPoint" DROP CONSTRAINT "CustomDataPoint_userId_fkey";

-- DropForeignKey
ALTER TABLE "GroupMembership" DROP CONSTRAINT "GroupMembership_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupMembership" DROP CONSTRAINT "GroupMembership_userId_fkey";

-- DropForeignKey
ALTER TABLE "JobApplication" DROP CONSTRAINT "JobApplication_userId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_groupId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_organizerId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingAttendee" DROP CONSTRAINT "MeetingAttendee_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingAttendee" DROP CONSTRAINT "MeetingAttendee_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserMonitorPreference" DROP CONSTRAINT "UserMonitorPreference_userId_fkey";

-- DropTable
DROP TABLE "BillRecord";

-- DropTable
DROP TABLE "CalendarChannel";

-- DropTable
DROP TABLE "CalendarEvent";

-- DropTable
DROP TABLE "CalendarShareLink";

-- DropTable
DROP TABLE "CustomDataPoint";

-- DropTable
DROP TABLE "Group";

-- DropTable
DROP TABLE "GroupMembership";

-- DropTable
DROP TABLE "JobApplication";

-- DropTable
DROP TABLE "Meeting";

-- DropTable
DROP TABLE "MeetingAttendee";

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "Task";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "UserMonitorPreference";

-- DropEnum
DROP TYPE "AttendeeStatus";

-- DropEnum
DROP TYPE "BillStatus";

-- DropEnum
DROP TYPE "BillType";

-- DropEnum
DROP TYPE "CustomStatus";

-- DropEnum
DROP TYPE "EventStatus";

-- DropEnum
DROP TYPE "GroupRole";

-- DropEnum
DROP TYPE "JobApplicationStatus";

-- DropEnum
DROP TYPE "MeetingStatus";

-- DropEnum
DROP TYPE "MonitoringCategory";

-- DropEnum
DROP TYPE "NotificationType";

-- DropEnum
DROP TYPE "TaskPriority";

-- DropEnum
DROP TYPE "TaskStatus";
