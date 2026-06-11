-- CreateTable
CREATE TABLE "CompanyMapping" (
    "id" TEXT NOT NULL,
    "netsuiteCompanyId" TEXT NOT NULL,
    "shopifyCompanyId" TEXT NOT NULL,
    "shopifyCompanyName" TEXT NOT NULL,
    "shopifyCompanyLocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMapping_netsuiteCompanyId_key" ON "CompanyMapping"("netsuiteCompanyId");
