/*
  Warnings:

  - Added the required column `priorityOrder` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "priorityOrder" INTEGER NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING';
