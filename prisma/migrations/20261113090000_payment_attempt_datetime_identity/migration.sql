ALTER TABLE "PaymentRetry"
  ALTER COLUMN "paymentInstructionId" DROP NOT NULL,
  ADD COLUMN "paymentAttemptDateTime" TIMESTAMP(3);

UPDATE "PaymentRetry" AS retry
SET "paymentAttemptDateTime" = COALESCE(
  (SELECT source_log."createdAt"
   FROM "OrderSyncLog" AS source_log
   WHERE source_log."id" = retry."sourceOrderSyncLogId"),
  retry."lastAttemptAt",
  retry."createdAt"
)
WHERE retry."paymentAttemptDateTime" IS NULL;

ALTER TABLE "PaymentRetry"
  ALTER COLUMN "paymentAttemptDateTime" SET NOT NULL;

ALTER TABLE "PaymentAttempt"
  ALTER COLUMN "paymentInstructionId" DROP NOT NULL,
  ADD COLUMN "paymentAttemptDateTime" TIMESTAMP(3);

UPDATE "PaymentAttempt"
SET "paymentAttemptDateTime" = COALESCE("lastAttemptAt", "createdAt")
WHERE "paymentAttemptDateTime" IS NULL;

ALTER TABLE "PaymentAttempt"
  ALTER COLUMN "paymentAttemptDateTime" SET NOT NULL;
