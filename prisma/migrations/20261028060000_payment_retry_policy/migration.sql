ALTER TABLE "PaymentRetry" ADD COLUMN IF NOT EXISTS "shop" TEXT;
ALTER TABLE "PaymentRetry" ALTER COLUMN "maxAttempts" SET DEFAULT 2;
UPDATE "PaymentRetry" SET "maxAttempts" = 2 WHERE "maxAttempts" <> 2;
UPDATE "PaymentRetry"
SET "status" = 'MANUAL_REVIEW', "nextRetryAt" = NULL
WHERE "status" = 'PENDING' AND "attemptCount" >= 2;
