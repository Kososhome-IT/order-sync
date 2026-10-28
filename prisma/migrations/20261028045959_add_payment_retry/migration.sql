-- CreateTable
CREATE TABLE "PaymentRetry" (
    "id" SERIAL NOT NULL,
    "orderSyncId" INTEGER NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "netsuiteOrderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "paymentReference" TEXT,
    "outcomeUnknown" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRetry_orderSyncId_key" ON "PaymentRetry"("orderSyncId");

-- CreateIndex
CREATE INDEX "PaymentRetry_status_nextRetryAt_idx" ON "PaymentRetry"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "PaymentRetry_shopifyOrderId_idx" ON "PaymentRetry"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "PaymentRetry_netsuiteOrderId_idx" ON "PaymentRetry"("netsuiteOrderId");

-- AddForeignKey
ALTER TABLE "PaymentRetry" ADD CONSTRAINT "PaymentRetry_orderSyncId_fkey" FOREIGN KEY ("orderSyncId") REFERENCES "OrderSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
