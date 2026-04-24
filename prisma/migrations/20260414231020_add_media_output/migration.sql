-- CreateTable
CREATE TABLE "MediaOutput" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaOutput_userId_idx" ON "MediaOutput"("userId");
