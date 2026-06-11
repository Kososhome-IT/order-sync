-- AlterTable
ALTER TABLE "OrderSyncLog" ADD COLUMN     "requestPayload" JSONB,
ADD COLUMN     "responsePayload" JSONB;
