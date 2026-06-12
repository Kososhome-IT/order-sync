-- CreateTable
CREATE TABLE "PaymentSync" (
    "id" TEXT NOT NULL,
    "netsuiteOrderId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "paymentReference" TEXT,
    "capturedAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSync_pkey" PRIMARY KEY ("id")
);
