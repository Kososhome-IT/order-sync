import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { verifyShopifyHmac } from "../utils/verifyShopifyHmac";

import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

export async function action({ request }) {
  try {
    const body = await request.text();

    verifyShopifyHmac(request, body);

    const payload = JSON.parse(body);

    const shopifyOrderId = String(payload.id);

    console.log(
      "WEBHOOK RECEIVED",
      shopifyOrderId,
      new Date().toISOString()
    );

    // Find existing sync record
    let orderSync =
      await prisma.orderSync.findUnique({
        where: {
          shopifyOrderId,
        },
      });

    // Create if missing
    if (!orderSync) {
      orderSync =
        await prisma.orderSync.create({
          data: {
            shopifyOrderId,
            originSystem: SYSTEM.SHOPIFY,
            lastSyncedFrom: SYSTEM.SHOPIFY,
            status: STATUS.PENDING,
            webhookPayload: payload,
          },
        });
    }

    // Log every webhook call
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.SHOPIFY,
        direction:
          DIRECTION.SHOPIFY_TO_NETSUITE,
        eventType: EVENT_TYPE.CREATE,
        status: STATUS.RECEIVED,
        rawPayload: payload,
      },
    });

    // Skip duplicates
    if (
      orderSync.status === STATUS.PROCESSING ||
      orderSync.status === STATUS.SUCCESS
    ) {
      console.log(
        `Skipping duplicate webhook ${shopifyOrderId}`
      );

      return json({ ok: true });
    }

    // Mark processing
    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        status: STATUS.PROCESSING,
      },
    });

    // Process Shopify -> NetSuite
    const netsuiteOrderId =
      await processShopifyOrder(
        orderSync.id
      );

    // Success
    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        netsuiteOrderId,
        status: STATUS.SUCCESS,
      },
    });

    return json({ ok: true });
  } catch (error) {
    console.error(
      "ORDER WEBHOOK ERROR",
      error
    );

    return json(
      {
        ok: false,
        error: error.message,
      },
      500
    );
  }
}