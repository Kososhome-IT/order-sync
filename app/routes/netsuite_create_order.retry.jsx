import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { authenticate, sessionStorage } from "../shopify.server";
import { fetchShopifyOrderById } from "../services/shopify/order.service";

export async function action({ request }) {
  console.log("[RETRY] ROUTE ENTERED");
  let claimedOrderSyncId = null;

  try {
    console.log("[RETRY] STARTING SHOPIFY ADMIN AUTH");

    const authResult = await authenticate.admin(request);

    console.log("[RETRY] SHOPIFY ADMIN AUTH SUCCESS");

      const { orderSyncId } = await request.json();
    console.log("RETRY REQUEST STARTED");
console.log("orderSyncId =", orderSyncId);

    const orderSync = await prisma.orderSync.findUnique({
      where: {
        id: Number(orderSyncId),
      },
    });
// console.log(
//   "ORDER SYNC",
//   JSON.stringify(orderSync, null, 2)
// );
    if (!orderSync) {
      return json(
        {
          success: false,
          error: "Order not found",
        },
        404
      );
    }

    if (orderSync.netsuiteOrderId) {
      return json(
        {
          success: false,
          error:
            "Order already exists in NetSuite",
        },
        400
      );
    }

    if (orderSync.status !== "FAILED") {
      return json(
        { success: false, error: `Order cannot be retried while status is ${orderSync.status}` },
        409
      );
    }

    if (!orderSync.shopifyOrderId) {
      return json(
        {
          success: false,
          error: "Shopify order ID missing for retry",
        },
        400
      );
    }

    const shopDomain = process.env.SHOP;
    const session = await sessionStorage.loadSession(`offline_${shopDomain}`);

    if (!session) {
      return json(
        {
          success: false,
          error: "Offline Shopify session not found",
        },
        400
      );
    }

    const claim = await prisma.orderSync.updateMany({
      where: { id: orderSync.id, status: "FAILED", netsuiteOrderId: null },
      data: { status: "PROCESSING" },
    });
    if (!claim.count) {
      return json({ success: false, error: "Order is already being processed" }, 409);
    }
    claimedOrderSyncId = orderSync.id;

    const freshShopifyOrder = await fetchShopifyOrderById({
      shop: shopDomain,
      accessToken: session.accessToken,
      orderId: orderSync.shopifyOrderId,
    });

    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: { webhookPayload: freshShopifyOrder },
    });

    const netsuiteOrderId =
      await processShopifyOrder(
        orderSync.id,
        { shopifyOrder: freshShopifyOrder }
      );
    claimedOrderSyncId = null;
console.log(
  "RETRY SUCCESS",
  netsuiteOrderId
);
    return json({
      success: true,
      netsuiteOrderId,
    });
  } catch (error) {
    if (claimedOrderSyncId) {
      const markedFailed = await prisma.orderSync.updateMany({
        where: { id: claimedOrderSyncId, status: "PROCESSING", netsuiteOrderId: null },
        data: { status: "FAILED", errorMessage: error.message },
      }).catch(() => {});
      if (markedFailed?.count) {
        await prisma.orderSyncLog.create({
          data: {
            orderSyncId: claimedOrderSyncId,
            sourceSystem: "SHOPIFY",
            direction: "SHOPIFY_TO_NETSUITE",
            eventType: "ORDER_CREATE",
            status: "FAILED",
            message: error.message,
            errorPayload: { message: error.message },
          },
        }).catch(() => {});
      }
    }
    return json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
}
