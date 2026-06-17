import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { processShopifyOrder } from "../services/netsuite/orderSync.service";
import { verifyShopifyHmac } from "../utils/verifyShopifyHmac";
import { getOrderSource } from "../services/shopify/orderSource.service";

import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

export async function action({ request }) {
  try {
    const body = await request.text();

    // HMAC Verification
    verifyShopifyHmac(request, body);

    const payload = JSON.parse(body);
    const shopifyOrderId = String(payload.id);
    const shopifyOrderName = String(payload.name);
    const SHOP_DOMAIN = process.env.SHOP;
    const API_VERSION = "2025-07";

    console.log(
      "WEBHOOK RECEIVED",
      shopifyOrderId,
      new Date().toISOString()
    );

    // 1. checking if order already exist
    let orderSync = await prisma.orderSync.findUnique({
      where: { shopifyOrderId },
    });

    // 2. sending response to webhook if order already in proccesing
    if (
      orderSync &&
      (orderSync.status === STATUS.PROCESSING || orderSync.status === STATUS.SUCCESS)
    ) {
      console.log(`Skipping duplicate webhook ${shopifyOrderId} (Early Catch)`);
      return json({ ok: true });
    }

    // 3. if no order exist create with PENDING state
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

    // 4. webhook call log
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

    // 5.  calling order porocess
    processOrderInBackground({
      orderSyncId: orderSync.id,
      shopifyOrderId,
      payload,
      SHOP_DOMAIN,
      API_VERSION,
    });

    // sent Shopify  200 OK to webhook
    return json({ ok: true });

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
 * order processing helper function
 */
async function processOrderInBackground({
  orderSyncId,
  shopifyOrderId,
  payload,
  SHOP_DOMAIN,
  API_VERSION,
}) {
  try {
    // adin client creation
    const session = await sessionStorage.loadSession(`offline_${SHOP_DOMAIN}`);
    const admin = createAdminApiClient({
      storeDomain: SHOP_DOMAIN,
      apiVersion: API_VERSION,
      accessToken: session.accessToken,
    });

    // Metafield value (Order Source) check
    const orderSource = await getOrderSource(admin, payload.id);

    // if orderSource "8" ह (coming from NetSuite ), skip it
    if (orderSource == "NETSUITE") {
      console.log("Skipping NetSuite order", payload.id);
      
      await prisma.orderSync.update({
        where: { id: orderSyncId },
        data: {
          status: STATUS.SKIPPED, 
        },
      });
      return;
    }

    // state PROCESSING to avoide race condtion
    await prisma.orderSync.update({
      where: { id: orderSyncId },
      data: { status: STATUS.PROCESSING },
    });

    // Shopify -> NetSuite link process
    const netsuiteOrderId = await processShopifyOrder(orderSyncId);

    // link sucess updation
    await prisma.orderSync.update({
      where: { id: orderSyncId },
      data: {
        netsuiteOrderId,
        status: STATUS.SUCCESS,
      },
    });

    console.log(`✅ Order ${shopifyOrderId} successfully synced to NetSuite.`);

  } catch (bgError) {
    console.error(`❌ Background Sync Failed for Order ${shopifyOrderId}:`, bgError);
    
    // failiure error saved to DB 
    await prisma.orderSync.update({
      where: { id: orderSyncId },
      data: {
        status: STATUS.FAILED,
        errorMessage: bgError.message,
      },
    }).catch(() => {});
  }
}