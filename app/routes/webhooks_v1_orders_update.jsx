import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { verifyShopifyHmac } from "../utils/verifyShopifyHmac";
import {processShopifyOrderUpdate} from "../services/netsuite/orderUpdate.service"
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

  // If order does not exist yet, ignore update safely
  if (!orderSync) {
    return json({ ignored: true });
  }
if (orderSync.originSystem === SYSTEM.NETSUITE) {
  return json({ ignored: true });
}

  
  // 2️⃣ Update state
  await prisma.orderSync.update({
    where: { id: orderSync.id },
    data: {
      lastSyncedFrom: SYSTEM.SHOPIFY,
    },
  });

  // 3️⃣ Append log
  await prisma.orderSyncLog.create({
    data: {
      orderSyncId: orderSync.id,
      sourceSystem: SYSTEM.SHOPIFY,
      direction: DIRECTION.SHOPIFY_TO_NETSUITE,
      eventType: EVENT_TYPE.UPDATE,
      status: STATUS.RECEIVED,
      rawPayload: payload,
    },
  });
await processShopifyOrderUpdate(orderSync.id)
  return json({ ok: true });
}
