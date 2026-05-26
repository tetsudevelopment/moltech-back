-- AlterTable
ALTER TABLE "verification_tokens" ADD COLUMN     "attempts_used" INTEGER NOT NULL DEFAULT 0;
