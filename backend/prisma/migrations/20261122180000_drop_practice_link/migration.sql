-- The AI interviewer now lives in the interview room and is reached with the invite link:
-- the separate practice link (and its columns) is gone.
DROP INDEX IF EXISTS "interviews_practiceTokenHash_key";

ALTER TABLE "interviews" DROP COLUMN IF EXISTS "practiceTokenHash",
DROP COLUMN IF EXISTS "practiceCreatedAt";
