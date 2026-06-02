import { v4 as uuidv4 } from "uuid";
import { createSyncLogger } from "../services/common/logger";
import { createFieldMapper } from "./field.mapper";
import { generateIdempotencyKey } from "./idempotency";
import * as syncLogModel from "../models/sync-log.model";
import * as syncStateModel from "../models/sync-state.model";
import * as entityMappingModel from "../models/entity-mapping.model";
import * as deadLetterModel from "../models/dead-letter.model";
import { hashRecord } from "../utils/crypto";
import { withRetry } from "../services/common/retry";
import { BATCH_SIZES, RETRY_CONFIG } from "../utils/constants";

export async function runInventorySync(
  deps,
  jobData,
) {
  const syncRunId = jobData.syncRunId || uuidv4();
  const log = createSyncLogger("inventory", syncRunId);

  const result = {
    syncRunId,
    entityType: "inventory",
    totalRecords: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    const syncState = await syncStateModel.getSyncState("inventory");
    if (!syncState?.isEnabled) {
      log.info("Inventory sync is disabled, skipping");
      return result;
    }

    const acquired = await syncStateModel.markSyncRunning("inventory");
    if (!acquired) {
      log.info("Inventory sync already running, skipping");
      return result;
    }

    const mapper = createFieldMapper();
    await mapper.loadMappings("inventory", "ns_to_shopify");

    const lastModifiedAfter =
      jobData.mode === "full" ? undefined : syncState.lastSuccessfulSyncAt?.toISOString();

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { items, hasMore: more, count } = await deps.fetchInventoryItems({
        lastModifiedAfter,
        pageSize: BATCH_SIZES.NETSUITE_PAGE,
        offset,
      });

      result.totalRecords = count;
      hasMore = more;
      offset += items.length;

      const batches = chunkArray(items, BATCH_SIZES.INVENTORY_SYNC);

      for (const batch of batches) {
        await processBatch(batch, deps, mapper, syncRunId, result, log);
      }
    }

    await syncStateModel.markSyncComplete("inventory", result.successCount, result.failedCount);
    log.info(
      { successCount: result.successCount, failedCount: result.failedCount, skippedCount: result.skippedCount },
      "Inventory sync completed",
    );
  } catch (error) {
    log.error({ error }, "Inventory sync failed");
    await syncStateModel.markSyncFailed("inventory");
    throw error;
  } finally {
    result.durationMs = Date.now() - startTime;
  }

  return result;
}

async function processBatch(
  items,
  deps,
  mapper,
  syncRunId,
  result,
  log,
) {
  const quantityUpdates = [];

  for (const item of items) {
    const startMs = Date.now();

    try {
      let mapping = await entityMappingModel.findByNetsuiteId("inventory_item", item.internalId);

      if (!mapping) {
        const variant = await deps.findVariantBySku(item.itemId || item.sku || "");
        if (!variant) {
          await syncLogModel.createSyncLog({
            syncRunId,
            entityType: "inventory",
            direction: "ns_to_shopify",
            operation: "update",
            status: "skipped",
            netsuiteId: item.internalId,
            errorMessage: "No matching Shopify variant found by SKU",
            durationMs: Date.now() - startMs,
          });
          result.skippedCount++;
          continue;
        }

        mapping = await entityMappingModel.upsertEntityMapping({
          entityType: "inventory_item",
          shopifyId: variant.inventoryItemId,
          netsuiteId: item.internalId,
          metadata: { sku: item.itemId },
        });
      }

      const netsuiteHash = hashRecord(item);
      if (mapping.netsuiteHash === netsuiteHash) {
        result.skippedCount++;
        continue;
      }

      quantityUpdates.push({
        inventoryItemId: mapping.shopifyId,
        locationId: "default",
        quantity: Math.max(0, Math.floor(item.quantityAvailable)),
      });

      await entityMappingModel.updateHashes(mapping.id, undefined, netsuiteHash);

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "inventory",
        direction: "ns_to_shopify",
        operation: "update",
        status: "success",
        shopifyId: mapping.shopifyId,
        netsuiteId: item.internalId,
        requestPayload: { quantity: item.quantityAvailable },
        durationMs: Date.now() - startMs,
      });

      result.successCount++;
    } catch (error) {
      result.failedCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({ id: item.internalId, error: errorMessage });

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "inventory",
        direction: "ns_to_shopify",
        operation: "update",
        status: "failed",
        netsuiteId: item.internalId,
        errorMessage,
        durationMs: Date.now() - startMs,
      });

      const errorCount = await syncStateModel.incrementErrorCount("inventory");
      if (errorCount >= RETRY_CONFIG.ERROR_THRESHOLD_PAUSE) {
        log.error("Error threshold exceeded, pausing inventory sync");
        await syncStateModel.updateSyncState("inventory", { status: "paused" });
        throw new Error("Error threshold exceeded");
      }
    }
  }

  if (quantityUpdates.length > 0) {
    try {
      await withRetry(() => deps.setInventoryQuantities(quantityUpdates));
    } catch (error) {
      log.error({ error, count: quantityUpdates.length }, "Failed to set inventory quantities batch");
      await deadLetterModel.addToDeadLetterQueue({
        entityType: "inventory",
        operation: "update",
        direction: "ns_to_shopify",
        payload: { updates: quantityUpdates },
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        retryCount: 0,
      });
    }
  }
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
