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

  // 1️⃣ Find existing OrderSync
  const orderSync = await prisma.orderSync.findUnique({
    where: { shopifyOrderId },
  });

  if (!orderSync) {
    return json({ ignored: true });
  }

  // 2️⃣ Update state
  await prisma.orderSync.update({
    where: { id: orderSync.id },
    data: {
      lastSyncedFrom: SYSTEM.SHOPIFY,
      status: STATUS.PENDING,
    },
  });

  // 3️⃣ Append log
  await prisma.orderSyncLog.create({
    data: {
      orderSyncId: orderSync.id,
      sourceSystem: SYSTEM.SHOPIFY,
      direction: DIRECTION.SHOPIFY_TO_NETSUITE,
      eventType: EVENT_TYPE.CANCEL,
      status: STATUS.RECEIVED,
      rawPayload: payload,
    },
  });

  return json({ ok: true });
}
