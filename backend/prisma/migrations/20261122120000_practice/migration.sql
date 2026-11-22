-- AI practice links (only the SHA-256 of the secret is stored) and AI practice sessions.
-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "practiceCreatedAt" TIMESTAMP(3),
ADD COLUMN     "practiceTokenHash" TEXT;

-- CreateTable
CREATE TABLE "ai_practice_sessions" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "language" TEXT NOT NULL,
    "code" TEXT,
    "report" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_practice_sessions_interviewId_idx" ON "ai_practice_sessions"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "interviews_practiceTokenHash_key" ON "interviews"("practiceTokenHash");

-- AddForeignKey
ALTER TABLE "ai_practice_sessions" ADD CONSTRAINT "ai_practice_sessions_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

