-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "codeLanguage" TEXT DEFAULT 'javascript',
ADD COLUMN     "codeSnapshot" TEXT,
ADD COLUMN     "questions" JSONB;
