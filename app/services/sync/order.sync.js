import { v4 as uuidv4 } from "uuid";
import { createSyncLogger } from "../services/common/logger";
import { createFieldMapper } from "./field.mapper";
import * as syncLogModel from "../models/sync-log.model";
import * as syncStateModel from "../models/sync-state.model";
import * as entityMappingModel from "../models/entity-mapping.model";
import * as deadLetterModel from "../models/dead-letter.model";
import { withRetry } from "../services/common/retry";
import { RETRY_CONFIG } from "../utils/constants";

export async function processOrderWebhook(
  deps,
  jobData,
) {
  const syncRunId = uuidv4();
  const log = createSyncLogger("order", syncRunId);

  const result = {
    syncRunId,
    entityType: "order",
    totalRecords: 1,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    const existingMapping = await entityMappingModel.findByShopifyId("order", jobData.shopifyId);
    if (existingMapping) {
      log.info({ shopifyOrderId: jobData.shopifyId }, "Order already synced, skipping");
      result.skippedCount = 1;
      return result;
    }

    const order = jobData.payload;

    const mapper = createFieldMapper();
    await mapper.loadMappings("order", "shopify_to_ns");

    const salesOrder = await transformOrderToSalesOrder(order, deps, mapper, log);

    if (!salesOrder) {
      result.failedCount = 1;
      await syncLogModel.createSyncLog({
        syncRunId,
        entityType: "order",
        direction: "shopify_to_ns",
        operation: "create",
        status: "failed",
        shopifyId: jobData.shopifyId,
        errorMessage: "Failed to transform order - missing required data",
        durationMs: Date.now() - startTime,
      });
      return result;
    }

    const nsResult = await withRetry(
      () => deps.createSalesOrder(salesOrder),
      { maxAttempts: 3 },
    );

    await entityMappingModel.upsertEntityMapping({
      entityType: "order",
      shopifyId: jobData.shopifyId,
      netsuiteId: nsResult.internalId,
      syncDirection: "shopify_to_ns",
      metadata: {
        shopifyOrderName: order.name,
        netsuiteTranId: nsResult.tranId,
      },
    });

    await syncLogModel.createSyncLog({
      syncRunId,
      entityType: "order",
      direction: "shopify_to_ns",
      operation: "create",
      status: "success",
      shopifyId: jobData.shopifyId,
      netsuiteId: nsResult.internalId,
      responsePayload: { tranId: nsResult.tranId },
      durationMs: Date.now() - startTime,
    });

    result.successCount = 1;
    log.info(
      { shopifyOrderId: jobData.shopifyId, netsuiteId: nsResult.internalId },
      "Order synced to NetSuite",
    );
  } catch (error) {
    result.failedCount = 1;
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push({ id: jobData.shopifyId, error: errorMessage });

    await syncLogModel.createSyncLog({
      syncRunId,
      entityType: "order",
      direction: "shopify_to_ns",
      operation: "create",
      status: "failed",
      shopifyId: jobData.shopifyId,
      errorMessage,
      durationMs: Date.now() - startTime,
    });

    const errorCount = await syncStateModel.incrementErrorCount("order");
    if (errorCount >= RETRY_CONFIG.ERROR_THRESHOLD_PAUSE) {
      await syncStateModel.updateSyncState("order", { status: "paused" });
    }

    await deadLetterModel.addToDeadLetterQueue({
      entityType: "order",
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

async function transformOrderToSalesOrder(
  order,
  deps,
  mapper,
  log,
) {
  let customerNetsuiteId = null;
  if (order.customer?.id) {
    customerNetsuiteId = await deps.findCustomerNetsuiteId(order.customer.id);
  }

  if (!customerNetsuiteId) {
    log.warn({ shopifyCustomerId: order.customer?.id }, "Customer not found in NetSuite");
    return null;
  }

  const lineItems = [];
  for (const edge of order.lineItems.edges) {
    const lineItem = edge.node;
    const nsItemId = await deps.findItemNetsuiteId(lineItem.sku);

    if (!nsItemId) {
      log.warn({ sku: lineItem.sku }, "Item SKU not mapped in NetSuite, skipping line");
      continue;
    }

    lineItems.push({
      item: nsItemId,
      quantity: lineItem.quantity,
      rate: parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount),
      amount: lineItem.quantity * parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount),
      description: lineItem.title,
    });
  }

  if (lineItems.length === 0) {
    log.warn("No line items could be mapped, skipping order");
    return null;
  }

  const shippingCost =
    order.shippingLines.edges.length > 0
      ? parseFloat(order.shippingLines.edges[0].node.originalPriceSet.shopMoney.amount)
      : 0;

  return {
    entity: customerNetsuiteId,
    tranDate: order.createdAt,
    items: lineItems,
    shippingCost,
    subtotal: parseFloat(order.subtotalPriceSet.shopMoney.amount),
    total: parseFloat(order.totalPriceSet.shopMoney.amount),
    memo: order.note || `Shopify Order ${order.name}`,
    shippingAddress: order.shippingAddress
      ? {
          addr1: order.shippingAddress.address1 || undefined,
          addr2: order.shippingAddress.address2 || undefined,
          city: order.shippingAddress.city || undefined,
          state: order.shippingAddress.provinceCode || undefined,
          zip: order.shippingAddress.zip || undefined,
          country: order.shippingAddress.countryCodeV2 || undefined,
        }
      : undefined,
    billingAddress: order.billingAddress
      ? {
          addr1: order.billingAddress.address1 || undefined,
          addr2: order.billingAddress.address2 || undefined,
          city: order.billingAddress.city || undefined,
          state: order.billingAddress.provinceCode || undefined,
          zip: order.billingAddress.zip || undefined,
          country: order.billingAddress.countryCodeV2 || undefined,
        }
      : undefined,
    customFields: {
      custbody_shopify_order_id: order.id,
      custbody_shopify_order_name: order.name,
    },
  };
}
