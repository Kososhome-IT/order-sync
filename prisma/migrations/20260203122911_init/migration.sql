-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
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
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "OrderSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netsuiteOrderId" TEXT,
    "shopifyOrderId" TEXT,
    "netsuiteCompanyId" TEXT,
    "originSystem" TEXT NOT NULL,
    "lastSyncedFrom" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'CREATE',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderSyncLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderSyncId" INTEGER NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "rawPayload" JSONB,
    "errorPayload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderSyncLog_orderSyncId_fkey" FOREIGN KEY ("orderSyncId") REFERENCES "OrderSync" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_netsuiteOrderId_key" ON "OrderSync"("netsuiteOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_shopifyOrderId_key" ON "OrderSync"("shopifyOrderId");
