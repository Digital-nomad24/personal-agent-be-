/*
  Warnings:

  - Added the required column `completionDate` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completionDate" TIMESTAMP(3) NOT NULL;
