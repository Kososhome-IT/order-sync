import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { jsonResponse } from "../utils/jsonResponse";
import {
  fulfillOrderFromNetSuite,
  toShopifyOrderGid,
} from "../services/shopify/fulfillment.service";
import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";


function  buildOrderSyncLookup(payload) {
  const filters = [];

  if (payload.netsuiteOrderId || payload.orderId) {
    filters.push({ netsuiteOrderId: String(payload.netsuiteOrderId || payload.orderId) });
  }

  if (payload.shopifyOrderName || payload.orderName) {
    filters.push({ shopifyOrderName: String(payload.shopifyOrderName || payload.orderName) });
  }

  if (payload.shopifyOrderId) {
    const shopifyOrderId = String(payload.shopifyOrderId);

    filters.push({ shopifyOrderId });

    if (!shopifyOrderId.startsWith("gid://shopify/Order/")) {
      filters.push({ shopifyOrderId: toShopifyOrderGid(shopifyOrderId) });
    }
  }

  return filters;
}

function getShopifyOrderId(orderSync, payload) {
  return (
    orderSync?.shopifyOrderId ||
    payload.shopifyOrderId ||
    payload.shopify_order_id
  );
}

export async function action({ request }) {
  let payload = null;
  let orderSync = null;

  if (request.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed" }, 405);
  }

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid JSON body" }, 400);
  }

  try {
    const lookupFilters = buildOrderSyncLookup(payload);

    if (lookupFilters.length === 0) {
      return jsonResponse(
        {
          success: false,
          message:
            "One of netsuiteOrderId, orderId, shopifyOrderId, shopifyOrderName, or orderName is required",
        },
        400
      );
    }

    orderSync = await prisma.orderSync.findFirst({
      where: {
        OR: lookupFilters,
      },
    });

    if (!orderSync && !payload.shopifyOrderId && !payload.shopify_order_id) {
      return jsonResponse(
        { success: false, message: "OrderSync record not found for fulfillment payload" },
        404
      );
    }

    const shopifyOrderId = getShopifyOrderId(orderSync, payload);

    if (!shopifyOrderId) {
      return jsonResponse(
        { success: false, message: "Shopify order ID is missing for this fulfillment" },
        400
      );
    }

    const shopDomain = process.env.SHOP;
    const session = await sessionStorage.loadSession(`offline_${shopDomain}`);

    if (!session) {
      throw new Error("Offline Shopify session not found");
    }

    const admin = createAdminApiClient({
      storeDomain: shopDomain,
      apiVersion: "2025-07",
      accessToken: session.accessToken,
    });

    if (orderSync) { 
      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: SYSTEM.NETSUITE,
          direction: DIRECTION.NETSUITE_TO_SHOPIFY,
          eventType: EVENT_TYPE.FULFILL,
          status: STATUS.RECEIVED,
          rawPayload: payload,
        },
      });
    }

    const result = await fulfillOrderFromNetSuite(admin, shopifyOrderId, payload);

    if (orderSync) {
      await prisma.orderSync.update({
        where: { id: orderSync.id },
        data: {
          lastSyncedFrom: SYSTEM.NETSUITE,
          status: STATUS.SUCCESS,
          action: EVENT_TYPE.FULFILL,
          errorMessage: null,
        },
      });

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: SYSTEM.NETSUITE,
          direction: DIRECTION.NETSUITE_TO_SHOPIFY,
          eventType: EVENT_TYPE.FULFILL,
          status: STATUS.SUCCESS,
          message: "Shopify fulfillment created from NetSuite payload",
          requestPayload: payload,
          responsePayload: JSON.parse(JSON.stringify(result)),
        },
      });
    }

    return jsonResponse({
      success: true,
      shopifyOrderId: toShopifyOrderGid(shopifyOrderId),
      shopifyOrderName: result.order.name,
      fulfillments: result.fulfillments.map((entry) => entry.fulfillment),
    });
  } catch (error) {
    console.error("[NetSuite Fulfillment] Failed:", error);

    if (orderSync) {
      await prisma.orderSync.update({
        where: { id: orderSync.id },
        data: {
          status: STATUS.FAILED,
          action: EVENT_TYPE.FULFILL,
          errorMessage: error.message,
        },
      });

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: SYSTEM.NETSUITE,
          direction: DIRECTION.NETSUITE_TO_SHOPIFY,
          eventType: EVENT_TYPE.FULFILL,
          status: STATUS.FAILED,
          message: error.message,
          requestPayload: payload || {},
          errorPayload: {
            message: error.message,
            stack: error.stack,
          },
        },
      });
    }

    return jsonResponse(
      {
        success: false,
        message: error.message,
      },
      500
    );
  }
}
