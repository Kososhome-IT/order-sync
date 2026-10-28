CREATE TABLE "PaymentRetryRun" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "schedulerJobName" TEXT,
    "dueCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "results" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRetryRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRetryRun_startedAt_idx" ON "PaymentRetryRun"("startedAt");
