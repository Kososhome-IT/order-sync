import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { unauthenticated } from "../shopify.server";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { verifyShopifyHmac } from "../utils/verifyShopifyHmac";
import { getOrderSource } from "../services/shopify/orderSource.service";

import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

import { SHOPIFY_CONFIG } from "../constants/integrationConfig";

export async function action({ request }) {
  try {
    const body = await request.text();

    // ---------------------------------------------------------
    // 1. HMAC Verification
    // ---------------------------------------------------------
    verifyShopifyHmac(request, body);

    const payload = JSON.parse(body);

    const shopifyOrderId = String(payload.id);
    const shopifyOrderName = String(payload.name);

    const SHOP_DOMAIN = process.env.SHOP;
    const API_VERSION = SHOPIFY_CONFIG.apiVersions.adminGraphql;

    console.log(
      "WEBHOOK RECEIVED",
      shopifyOrderId,
      new Date().toISOString()
    );

    // ---------------------------------------------------------
    // 2. Find existing OrderSync
    // ---------------------------------------------------------
    let orderSync = await prisma.orderSync.findUnique({
      where: {
        shopifyOrderId,
      },
    });

    // ---------------------------------------------------------
    // 3. Create OrderSync if it doesn't exist
    // ---------------------------------------------------------
    if (!orderSync) {
      try {
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
      } catch (error) {
        // Another webhook request may have created
        // the same order at the same time.
        if (error.code === "P2002") {
          orderSync = await prisma.orderSync.findUnique({
            where: {
              shopifyOrderId,
            },
          });
        } else {
          throw error;
        }
      }
    }

    if (!orderSync) {
      throw new Error(
        `Unable to create/find OrderSync for Shopify order ${shopifyOrderId}`
      );
    }

    // ---------------------------------------------------------
    // 4. Log webhook
    // ---------------------------------------------------------
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

    // ---------------------------------------------------------
    // 5. ATOMIC CLAIM
    //
    // Only ONE webhook request can change:
    //
    // PENDING -> PROCESSING
    //
    // If another request already changed it,
    // updateMany returns count = 0.
    // ---------------------------------------------------------
    const claim = await prisma.orderSync.updateMany({
      where: {
        id: orderSync.id,
        status: STATUS.PENDING,
      },
      data: {
        status: STATUS.PROCESSING,
      },
    });

    // ---------------------------------------------------------
    // 6. Duplicate webhook
    // ---------------------------------------------------------
    if (claim.count === 0) {
      console.log(
        `Skipping duplicate webhook for Shopify order ${shopifyOrderId}. ` +
        `Current status: ${orderSync.status}`
      );

      // Shopify only needs a successful response.
      return json({
        ok: true,
        duplicate: true,
      });
    }

    console.log(
      `Order ${shopifyOrderId} claimed for processing.`
    );

    // ---------------------------------------------------------
    // 7. Process order in background
    // ---------------------------------------------------------
    processOrderInBackground({
      orderSyncId: orderSync.id,
      shopifyOrderId,
      payload,
      SHOP_DOMAIN,
      API_VERSION,
    }).catch((error) => {
      console.error(
        `Background process crashed for ${shopifyOrderId}:`,
        error
      );
    });

    // ---------------------------------------------------------
    // 8. Return 200 immediately to Shopify
    // ---------------------------------------------------------
    return json({
      ok: true,
    });

  } catch (error) {
    console.error("ORDER WEBHOOK ERROR", error);

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
 * Process Shopify order in background
 */
async function processOrderInBackground({
  orderSyncId,
  shopifyOrderId,
  payload,
  SHOP_DOMAIN,
  API_VERSION,
}) {
  try {
    // ---------------------------------------------------------
    // 1. Create unauthenticated Shopify Admin client
    // ---------------------------------------------------------
    const { admin } = await unauthenticated.admin(SHOP_DOMAIN);

    // ---------------------------------------------------------
    // 2. Check Order Source
    // ---------------------------------------------------------
    const orderSource = await getOrderSource(
      admin,
      payload.id
    );

    // ---------------------------------------------------------
    // 3. Skip orders coming from NetSuite
    // ---------------------------------------------------------
    if (orderSource === "NETSUITE") {
      console.log(
        `Skipping NetSuite order ${shopifyOrderId}`
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

    // ---------------------------------------------------------
    // IMPORTANT:
    //
    // Do NOT set PROCESSING here.
    //
    // The order was already atomically claimed
    // before this function was called.
    // ---------------------------------------------------------

    console.log(
      `Starting Shopify -> NetSuite sync for ${shopifyOrderId}`
    );

    // ---------------------------------------------------------
    // 4. Shopify -> NetSuite
    // ---------------------------------------------------------
    const netsuiteOrderId =
      await processShopifyOrder(orderSyncId);

    // ---------------------------------------------------------
    // 5. Mark SUCCESS
    // ---------------------------------------------------------
    await prisma.orderSync.update({
      where: {
        id: orderSyncId,
      },
      data: {
        netsuiteOrderId,
        status: STATUS.SUCCESS,
        errorMessage: null,
      },
    });

    console.log(
      `Order ${shopifyOrderId} successfully synced to NetSuite.`
    );

  } catch (bgError) {
    console.error(
      `Background Sync Failed for Order ${shopifyOrderId}:`,
      bgError
    );

    // ---------------------------------------------------------
    // 6. Mark FAILED
    // ---------------------------------------------------------
    await prisma.orderSync
      .update({
        where: {
          id: orderSyncId,
        },
        data: {
          status: STATUS.FAILED,
          errorMessage:
            bgError?.message || String(bgError),
        },
      })
      .catch((dbError) => {
        console.error(
          "Failed to update OrderSync failure status:",
          dbError
        );
      });
  }
}