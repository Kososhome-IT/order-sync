import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { authenticate } from "../shopify.server";

export async function action({ request }) {
  await authenticate.admin(request);

  try {
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

    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        status: "PROCESSING",
      },
    });

    const netsuiteOrderId =
      await processShopifyOrder(
        orderSync.id
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