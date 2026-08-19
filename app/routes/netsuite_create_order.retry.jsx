import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { authenticate, sessionStorage } from "../shopify.server";
import { fetchShopifyOrderById } from "../services/shopify/order.service";

export async function action({ request }) {
  console.log("[RETRY] ROUTE ENTERED");

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
console.log(
  "ORDER SYNC",
  JSON.stringify(orderSync, null, 2)
);
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

    const freshShopifyOrder = await fetchShopifyOrderById({
      shop: shopDomain,
      accessToken: session.accessToken,
      orderId: orderSync.shopifyOrderId,
    });

    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        status: "PROCESSING",
        webhookPayload: freshShopifyOrder,
      },
    });

    const netsuiteOrderId =
      await processShopifyOrder(
        orderSync.id,
        { shopifyOrder: freshShopifyOrder }
      );
console.log(
  "RETRY SUCCESS",
  netsuiteOrderId
);
    return json({
      success: true,
      netsuiteOrderId,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
}
