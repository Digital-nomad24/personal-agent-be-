/*
  Warnings:

  - Added the required column `location` to the `CalendarAccessRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CalendarAccessRequest" ADD COLUMN     "location" TEXT NOT NULL;
