-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "aiInterviewerEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "company" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "interviewLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "ai_practice_sessions" ADD COLUMN     "avatarTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "presentedIndex" INTEGER;
