-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netsuiteOrderId" TEXT NOT NULL,
    "netsuiteCompanyId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "action" TEXT NOT NULL DEFAULT 'CREATE',
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_OrderSync" ("createdAt", "errorMessage", "id", "netsuiteCompanyId", "netsuiteOrderId", "shopifyOrderId", "status") SELECT "createdAt", "errorMessage", "id", "netsuiteCompanyId", "netsuiteOrderId", "shopifyOrderId", "status" FROM "OrderSync";
DROP TABLE "OrderSync";
ALTER TABLE "new_OrderSync" RENAME TO "OrderSync";
CREATE UNIQUE INDEX "OrderSync_netsuiteOrderId_key" ON "OrderSync"("netsuiteOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
