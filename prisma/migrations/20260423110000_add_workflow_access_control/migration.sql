-- AlterTable
ALTER TABLE "User" ADD COLUMN     "group" TEXT NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "accessConfig" TEXT;
