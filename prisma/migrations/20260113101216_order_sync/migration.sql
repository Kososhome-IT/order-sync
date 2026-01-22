-- CreateTable
CREATE TABLE "OrderSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netsuiteOrderId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_netsuiteOrderId_key" ON "OrderSync"("netsuiteOrderId");
