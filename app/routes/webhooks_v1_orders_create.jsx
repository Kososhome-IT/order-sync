import { json } from "../utils/jsonResponse";
import { processShopifyOrder }
  from "../services/netsuite/orderSync.service";
import prisma from "../db.server";
import { verifyShopifyHmacResult } from "../utils/verifyShopifyHmac";
import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";
 
export async function action({ request }) {
  const body = await request.text();
  const hmacResult = verifyShopifyHmacResult(request, body);
 
  if (!hmacResult.ok) {
    console.warn("Rejected Shopify orders/create webhook", {
      reason: hmacResult.reason,
      topic: request.headers.get("x-shopify-topic"),
      shop: request.headers.get("x-shopify-shop-domain"),
      webhookId: request.headers.get("x-shopify-webhook-id"),
    });
 
    return json(
      { ok: false, error: "Invalid Shopify HMAC", reason: hmacResult.reason },
      { status: 401 },
    );
  }
 
  const payload = JSON.parse(body);
  const shopifyOrderId = String(payload.id);
 
  // 1. Create or find OrderSync (STATE)
  let orderSync = await prisma.orderSync.findUnique({
    where: { shopifyOrderId },
  });
 
  if (orderSync?.status === STATUS.SUCCESS || orderSync?.netsuiteOrderId) {
    return json({
      ok: true,
      skipped: true,
      reason: "Order already synced",
      netsuiteOrderId: orderSync.netsuiteOrderId,
    });
  }
 
  if (orderSync?.status === STATUS.PROCESSING) {
    return json({
      ok: true,
      skipped: true,
      reason: "Order sync already in progress",
    });
  }
 
  if (!orderSync) {
    orderSync = await prisma.orderSync.create({
      data: {
        shopifyOrderId,
        originSystem: SYSTEM.SHOPIFY,
        lastSyncedFrom: SYSTEM.SHOPIFY,
        status: STATUS.PENDING,
      },
    });
  }
 
  const claimed = await prisma.orderSync.updateMany({
    where: {
      id: orderSync.id,
      status: { in: [STATUS.PENDING, STATUS.FAILED] },
    },
    data: {
      status: STATUS.PROCESSING,
      errorMessage: null,
    },
  });
 
  if (claimed.count === 0) {
    return json({
      ok: true,
      skipped: true,
      reason: "Order sync already handled",
    });
  }
 
  // 2. Create log (EVENT)
  await prisma.orderSyncLog.create({
    data: {
      orderSyncId: orderSync.id,
      sourceSystem: SYSTEM.SHOPIFY,
      direction: DIRECTION.SHOPIFY_TO_NETSUITE,
      eventType: EVENT_TYPE.CREATE,
      status: STATUS.RECEIVED,
      rawPayload: payload,
    },
  });
// 3.  Queue NetSuite sync job
//   await orderQueue.add(
//   "shopify-order-create",
//   {
//     orderSyncId: orderSync.id,
//     shopifyOrderId,
//   }
// );
 
  try {
    await processShopifyOrder(
      orderSync.id
    );
  } catch (error) {
    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        status: STATUS.FAILED,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
 
    throw error;
  }
 
  return json({ ok: true });
}
 