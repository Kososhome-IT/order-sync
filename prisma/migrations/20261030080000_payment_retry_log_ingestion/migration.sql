DROP INDEX IF EXISTS "PaymentRetry_orderSyncId_key";

ALTER TABLE "PaymentRetry"
  ADD COLUMN IF NOT EXISTS "paymentInstructionId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOrderSyncLogId" INTEGER;

UPDATE "PaymentRetry"
SET
  "paymentInstructionId" = COALESCE("paymentInstructionId", 'legacy-' || "id"::TEXT),
  "paymentKey" = COALESCE("paymentKey", 'legacy-' || "id"::TEXT),
  "sourceOrderSyncLogId" = COALESCE("sourceOrderSyncLogId", -"id")
WHERE "paymentInstructionId" IS NULL
   OR "paymentKey" IS NULL
   OR "sourceOrderSyncLogId" IS NULL;

ALTER TABLE "PaymentRetry"
  ALTER COLUMN "paymentInstructionId" SET NOT NULL,
  ALTER COLUMN "paymentKey" SET NOT NULL,
  ALTER COLUMN "sourceOrderSyncLogId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRetry_paymentKey_key" ON "PaymentRetry"("paymentKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRetry_sourceOrderSyncLogId_key" ON "PaymentRetry"("sourceOrderSyncLogId");
CREATE INDEX IF NOT EXISTS "PaymentRetry_orderSyncId_idx" ON "PaymentRetry"("orderSyncId");

CREATE TABLE "PaymentAttempt" (
    "id" SERIAL NOT NULL,
    "orderSyncId" INTEGER NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "paymentKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "idempotencyKey" TEXT,
    "paymentReference" TEXT,
    "outcomeUnknown" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_paymentKey_key" ON "PaymentAttempt"("paymentKey");
CREATE INDEX "PaymentAttempt_orderSyncId_idx" ON "PaymentAttempt"("orderSyncId");

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_orderSyncId_fkey"
  FOREIGN KEY ("orderSyncId") REFERENCES "OrderSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentRetryCursor" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PAYMENT_CAPTURE',
    "lastOrderSyncLogId" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRetryCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRetryCursor_scope_key" ON "PaymentRetryCursor"("scope");
