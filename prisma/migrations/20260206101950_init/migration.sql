-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSync" (
    "id" SERIAL NOT NULL,
    "netsuiteOrderId" TEXT,
    "shopifyOrderId" TEXT,
    "netsuiteCompanyId" TEXT,
    "originSystem" TEXT NOT NULL,
    "lastSyncedFrom" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'CREATE',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSyncLog" (
    "id" SERIAL NOT NULL,
    "orderSyncId" INTEGER NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "rawPayload" JSONB,
    "errorPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_netsuiteOrderId_key" ON "OrderSync"("netsuiteOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_shopifyOrderId_key" ON "OrderSync"("shopifyOrderId");

-- AddForeignKey
ALTER TABLE "OrderSyncLog" ADD CONSTRAINT "OrderSyncLog_orderSyncId_fkey" FOREIGN KEY ("orderSyncId") REFERENCES "OrderSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
