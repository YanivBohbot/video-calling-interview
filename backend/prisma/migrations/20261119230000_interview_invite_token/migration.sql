-- Candidate invite links: only the SHA-256 of the secret is stored.
ALTER TABLE "interviews" ADD COLUMN "inviteTokenHash" TEXT,
ADD COLUMN "inviteCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "interviews_inviteTokenHash_key" ON "interviews"("inviteTokenHash");
