import { json } from "../utils/jsonResponse";
import { processShopifyOrder }
  from "../services/netsuite/orderSync.service";
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
// 3.  Queue NetSuite sync job
//   await orderQueue.add(
//   "shopify-order-create",
//   {
//     orderSyncId: orderSync.id,
//     shopifyOrderId,
//   }
// );

//  added duplicate protection if order already exist it return back
const existingSuccess = await prisma.orderSyncLog.findFirst({
  where: {
    orderSyncId: orderSync.id,
    sourceSystem: SYSTEM.NETSUITE,
    eventType: EVENT_TYPE.CREATE,
    status: STATUS.SUCCESS,
  },
});

if (existingSuccess) {
  console.log(
    `Order already synced to NetSuite: ${shopifyOrderId}`
  );

  return json({ ok: true });
}


await processShopifyOrder(
  orderSync.id
);

  return json({ ok: true });
}
