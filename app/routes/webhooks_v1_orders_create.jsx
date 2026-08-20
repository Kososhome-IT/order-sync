import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { authenticate } from "../shopify.server";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { getOrderSource } from "../services/shopify/orderSource.service";

import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

export async function action({ request }) {
  try {
    // Shopify handles:
    // - Webhook HMAC verification
    // - Shop identification
    // - Offline session loading
    // - Expiring offline token refresh
    // - Admin API client creation
    const { shop, payload, admin, session } =
      await authenticate.webhook(request);

    if (!session || !admin) {
      console.error(
        `[WEBHOOK] No valid Shopify session/admin for shop ${shop}`
      );

      return json(
        {
          ok: false,
          error: "Shopify offline session is unavailable",
        },
        401
      );
    }

    const shopifyOrderId = String(payload.id);
    const shopifyOrderName = String(payload.name);

    console.log(
      "[WEBHOOK RECEIVED]",
      {
        shop,
        shopifyOrderId,
        shopifyOrderName,
        receivedAt: new Date().toISOString(),
        tokenExpires: session.expires || null,
        refreshTokenExpires: session.refreshTokenExpires || null,
        tokenIsExpired:
          typeof session.isExpired === "function"
            ? session.isExpired()
            : null,
      }
    );

    // 1. Check whether order already exists
    let orderSync = await prisma.orderSync.findUnique({
      where: {
        shopifyOrderId,
      },
    });

    // 2. Skip duplicate webhook if already processing/successful
    if (
      orderSync &&
      (
        orderSync.status === STATUS.PROCESSING ||
        orderSync.status === STATUS.SUCCESS
      )
    ) {
      console.log(
        `Skipping duplicate webhook ${shopifyOrderId} (Early Catch)`
      );

      return json({
        ok: true,
      });
    }

    // 3. Create order sync record if it does not exist
    if (!orderSync) {
      orderSync = await prisma.orderSync.create({
        data: {
          shopifyOrderId,
          shopifyOrderName,
          originSystem: SYSTEM.SHOPIFY,
          lastSyncedFrom: SYSTEM.SHOPIFY,
          status: STATUS.PENDING,
          webhookPayload: payload,
        },
      });
    }

    // 4. Log webhook reception
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

    // 5. Start background processing.
    //
    // IMPORTANT:
    // We pass the Admin client returned by authenticate.webhook().
    // That client was created using the valid/refreshed offline session.
    processOrderInBackground({
      orderSyncId: orderSync.id,
      shopifyOrderId,
      payload,
      admin,
    }).catch((error) => {
      console.error(
        `[WEBHOOK BACKGROUND UNHANDLED ERROR] Order ${shopifyOrderId}`,
        error
      );
    });

    // 6. Respond to Shopify immediately
    return json({
      ok: true,
    });
  } catch (error) {
    console.error("[ORDER WEBHOOK ERROR]", error);

    return json(
      {
        ok: false,
        error: error.message,
      },
      500
    );
  }
}

/**
 * Process Shopify order in background.
 */
async function processOrderInBackground({
  orderSyncId,
  shopifyOrderId,
  payload,
  admin,
}) {
  try {
    // IMPORTANT:
    // Do NOT load the offline session again here.
    // Do NOT create another Admin client here.
    //
    // authenticate.webhook() already handled the session
    // and token refresh before this function was started.

    // Check Order Source using the authenticated Admin client
    const orderSource = await getOrderSource(
      admin,
      payload.id
    );

    // Skip orders created from NetSuite
    if (orderSource === "NETSUITE") {
      console.log(
        "Skipping NetSuite order",
        payload.id
      );

      await prisma.orderSync.update({
        where: {
          id: orderSyncId,
        },
        data: {
          status: STATUS.SKIPPED,
        },
      });

      return;
    }

    // Mark as processing
    await prisma.orderSync.update({
      where: {
        id: orderSyncId,
      },
      data: {
        status: STATUS.PROCESSING,
      },
    });

    // Shopify → NetSuite
    //
    // IMPORTANT:
    // We also need to pass `admin` into processShopifyOrder()
    // so that all Shopify GraphQL calls use the same valid client.
    const netsuiteOrderId =
      await processShopifyOrder(
        orderSyncId,
        admin
      );

    // Mark success
    await prisma.orderSync.update({
      where: {
        id: orderSyncId,
      },
      data: {
        netsuiteOrderId,
        status: STATUS.SUCCESS,
      },
    });

    console.log(
      `✅ Order ${shopifyOrderId} successfully synced to NetSuite.`
    );
  } catch (bgError) {
    console.error(
      `❌ Background Sync Failed for Order ${shopifyOrderId}:`,
      bgError
    );

    await prisma.orderSync
      .update({
        where: {
          id: orderSyncId,
        },
        data: {
          status: STATUS.FAILED,
          errorMessage: bgError.message,
        },
      })
      .catch((dbError) => {
        console.error(
          "[ORDER SYNC] Failed to save background error",
          dbError
        );
      });
  }
}