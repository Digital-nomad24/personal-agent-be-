-- CreateEnum
CREATE TYPE "MonitoringCategory" AS ENUM ('JOBS', 'BILLS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BillType" AS ENUM ('CREDIT_CARD', 'SUBSCRIPTION', 'UTILITY', 'INSURANCE', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PAID', 'DUE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "CustomStatus" AS ENUM ('PENDING', 'DONE', 'NOTIFIED');

-- CreateTable
CREATE TABLE "UserMonitorPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "MonitoringCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMonitorPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "appliedDate" TIMESTAMP(3) NOT NULL,
    "status" "JobApplicationStatus" NOT NULL,
    "sourceEmailId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "billType" "BillType" NOT NULL,
    "provider" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "sourceEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDataPoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "status" "CustomStatus" NOT NULL,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDataPoint_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UserMonitorPreference" ADD CONSTRAINT "UserMonitorPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillRecord" ADD CONSTRAINT "BillRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDataPoint" ADD CONSTRAINT "CustomDataPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
