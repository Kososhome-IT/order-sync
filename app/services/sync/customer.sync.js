import { v4 as uuidv4 } from "uuid";
import { createSyncLogger } from "../services/common/logger";
import { createFieldMapper } from "./field.mapper";
import { checkForConflict, resolveConflict } from "./conflict.resolver";
import { hashRecord } from "../utils/crypto";
import * as syncLogModel from "../models/sync-log.model";
import * as syncStateModel from "../models/sync-state.model";
import * as entityMappingModel from "../models/entity-mapping.model";
import * as deadLetterModel from "../models/dead-letter.model";
import { withRetry } from "../services/common/retry";
import { RETRY_CONFIG } from "../utils/constants";

export async function runCustomerPollSync(
  deps,
  jobData,
) {
  const syncRunId = jobData.syncRunId || uuidv4();
  const log = createSyncLogger("customer", syncRunId);

  const result = {
    syncRunId,
    entityType: "customer",
    totalRecords: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    const syncState = await syncStateModel.getSyncState("customer");
    if (!syncState?.isEnabled) {
      log.info("Customer sync is disabled, skipping");
      return result;
    }

    const acquired = await syncStateModel.markSyncRunning("customer");
    if (!acquired) {
      log.info("Customer sync already running, skipping");
      return result;
    }

    const mapper = createFieldMapper();
    await mapper.loadMappings("customer", "ns_to_shopify");

    const lastModifiedAfter =
      jobData.mode === "full" ? undefined : syncState.lastSuccessfulSyncAt?.toISOString();

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { items, hasMore: more, count } = await deps.fetchNetSuiteCustomers({
        lastModifiedAfter,
        pageSize: 100,
        offset,
      });

      result.totalRecords = count;
      hasMore = more;
      offset += items.length;

      for (const nsCustomer of items) {
        await processNetSuiteCustomer(nsCustomer, deps, mapper, syncRunId, result, log);
      }
    }

    await syncStateModel.markSyncComplete("customer", result.successCount, result.failedCount);
    log.info(result, "Customer poll sync completed");
  } catch (error) {
    log.error({ error }, "Customer poll sync failed");
    await syncStateModel.markSyncFailed("customer");
    throw error;
  } finally {
    result.durationMs = Date.now() - startTime;
  }

  return result;
}

async function processNetSuiteCustomer(
  nsCustomer,
  deps,
  mapper,
  syncRunId,
  result,
  log,
) {
  const startMs = Date.now();

  try {
    const mapping = await entityMappingModel.findByNetsuiteId("customer", nsCustomer.internalId);
    const currentNetsuiteHash = hashRecord(nsCustomer);

    if (mapping) {
      if (mapping.netsuiteHash === currentNetsuiteHash) {
        result.skippedCount++;
        return;
      }

      const shopifyCustomer = await deps.fetchShopifyCustomer(mapping.shopifyId);
      const currentShopifyHash = hashRecord(shopifyCustomer);

      const conflict = checkForConflict(
        { ...mapping, shopifyHash: mapping.shopifyHash || "", netsuiteHash: mapping.netsuiteHash || "" },
        shopifyCustomer,
        nsCustomer,
      );

      if (conflict.hasConflict) {
        const resolution = resolveConflict(
          shopifyCustomer,
          nsCustomer,
          deps.conflictStrategy,
        );

        await syncLogModel.createSyncLog({
          syncRunId,
          entityType: "customer",
          direction: "ns_to_shopify",
          operation: "update",
          status: resolution.requiresManualResolution ? "skipped" : "processing",
          shopifyId: mapping.shopifyId,
          netsuiteId: nsCustomer.internalId,
          requestPayload: { conflict: true, resolution: resolution.reason },
          durationMs: Date.now() - startMs,
        });

        if (resolution.requiresManualResolution) {
          result.skippedCount++;
          return;
        }

        if (resolution.winner === "shopify") {
          const transformedData = mapper.transform(
            shopifyCustomer,
            "shopify_to_ns",
          );
          await withRetry(() => deps.updateNetSuiteCustomer(nsCustomer.internalId, transformedData));
        } else {
          const transformedData = mapper.transform(
            nsCustomer,
            "ns_to_shopify",
          );
          await withRetry(() => deps.updateShopifyCustomer(mapping.shopifyId, transformedData));
        }
      } else {
        const transformedData = mapper.transform(
          nsCustomer,
          "ns_to_shopify",
        );
        await withRetry(() => deps.updateShopifyCustomer(mapping.shopifyId, transformedData));
      }

      await entityMappingModel.updateHashes(mapping.id, undefined, currentNetsuiteHash);

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "customer",
        direction: "ns_to_shopify",
        operation: "update",
        status: "success",
        shopifyId: mapping.shopifyId,
        netsuiteId: nsCustomer.internalId,
        durationMs: Date.now() - startMs,
      });

      result.successCount++;
    } else {
      const transformedData = mapper.transform(
        nsCustomer,
        "ns_to_shopify",
      );

      const shopifyResult = await withRetry(() => deps.createShopifyCustomer(transformedData));

      await entityMappingModel.upsertEntityMapping({
        entityType: "customer",
        shopifyId: shopifyResult.id,
        netsuiteId: nsCustomer.internalId,
        netsuiteHash: currentNetsuiteHash,
        syncDirection: "ns_to_shopify",
        metadata: { email: nsCustomer.email },
      });

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "customer",
        direction: "ns_to_shopify",
        operation: "create",
        status: "success",
        shopifyId: shopifyResult.id,
        netsuiteId: nsCustomer.internalId,
        durationMs: Date.now() - startMs,
      });

      result.successCount++;
    }
  } catch (error) {
    result.failedCount++;
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push({ id: nsCustomer.internalId, error: errorMessage });

    await syncLogModel.createSyncLog({
      syncRunId,
      entityType: "customer",
      direction: "ns_to_shopify",
      operation: "update",
      status: "failed",
      netsuiteId: nsCustomer.internalId,
      errorMessage,
      durationMs: Date.now() - startMs,
    });

    const errorCount = await syncStateModel.incrementErrorCount("customer");
    if (errorCount >= RETRY_CONFIG.ERROR_THRESHOLD_PAUSE) {
      await syncStateModel.updateSyncState("customer", { status: "paused" });
      throw new Error("Error threshold exceeded");
    }
  }
}

export async function processCustomerWebhook(
  deps,
  jobData,
) {
  const syncRunId = uuidv4();
  const log = createSyncLogger("customer", syncRunId);

  const result = {
    syncRunId,
    entityType: "customer",
    totalRecords: 1,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    const customer = jobData.payload;
    const mapper = createFieldMapper();
    await mapper.loadMappings("customer", "shopify_to_ns");

    const transformedData = mapper.transform(
      customer,
      "shopify_to_ns",
    );

    const mapping = await entityMappingModel.findByShopifyId("customer", jobData.shopifyId);

    if (mapping) {
      await withRetry(() => deps.updateNetSuiteCustomer(mapping.netsuiteId, transformedData));

      const newHash = hashRecord(customer);
      await entityMappingModel.updateHashes(mapping.id, newHash, undefined);

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "customer",
        direction: "shopify_to_ns",
        operation: "update",
        status: "success",
        shopifyId: jobData.shopifyId,
        netsuiteId: mapping.netsuiteId,
        durationMs: Date.now() - startTime,
      });
    } else {
      const nsResult = await withRetry(() => deps.createNetSuiteCustomer(transformedData));

      await entityMappingModel.upsertEntityMapping({
        entityType: "customer",
        shopifyId: jobData.shopifyId,
        netsuiteId: nsResult.internalId,
        shopifyHash: hashRecord(customer),
        syncDirection: "shopify_to_ns",
        metadata: { email: customer.email },
      });

      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "customer",
        direction: "shopify_to_ns",
        operation: "create",
        status: "success",
        shopifyId: jobData.shopifyId,
        netsuiteId: nsResult.internalId,
        durationMs: Date.now() - startTime,
      });
    }

    result.successCount = 1;
    log.info({ shopifyCustomerId: jobData.shopifyId }, "Customer webhook processed");
  } catch (error) {
    result.failedCount = 1;
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push({ id: jobData.shopifyId, error: errorMessage });

    await syncLogModel.createSyncLog({
      syncRunId,
      entityType: "customer",
      direction: "shopify_to_ns",
      operation: mapping ? "update" : "create",
      status: "failed",
      shopifyId: jobData.shopifyId,
      errorMessage,
      durationMs: Date.now() - startTime,
    });

    await deadLetterModel.addToDeadLetterQueue({
      entityType: "customer",
      operation: "create",
      direction: "shopify_to_ns",
      payload: jobData.payload,
      errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined,
      retryCount: 0,
    });
  } finally {
    result.durationMs = Date.now() - startTime;
  }

  return result;
}

// Helper variable for webhook create/update detection
let mapping = null;
