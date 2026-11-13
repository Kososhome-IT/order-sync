CREATE TABLE "OrderResyncCursor" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SHOPIFY_ORDER_RESYNC',
    "lastOrderId" TEXT NOT NULL DEFAULT '0',
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderResyncCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderResyncCursor_scope_key" ON "OrderResyncCursor"("scope");

CREATE TABLE "OrderResyncRun" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "cursorStart" TEXT NOT NULL,
    "cursorEnd" TEXT,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "retriedCount" INTEGER NOT NULL DEFAULT 0,
    "successfulCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "OrderResyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderResyncRun_startedAt_idx" ON "OrderResyncRun"("startedAt");
