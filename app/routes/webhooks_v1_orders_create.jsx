import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { verifyShopifyHmac } from "../utils/verifyShopifyHmac";
import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

export async function action({ request }) {
  const body = await request.text();
  verifyShopifyHmac(request, body);

  const payload = JSON.parse(body);
  const shopifyOrderId = String(payload.id);

  // 1. Create or find OrderSync (STATE)
  let orderSync = await prisma.orderSync.findUnique({
    where: { shopifyOrderId },
  });

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

  return json({ ok: true });
}
