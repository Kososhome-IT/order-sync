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
import { SHOPIFY_CONFIG } from "../constants/integrationConfig";


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

// export async function action({ request }) {
//   let payload = null;
//   let orderSync = null;

//   if (request.method !== "POST") {
//     return jsonResponse({ success: false, message: "Method not allowed" }, 405);
//   }

//   try {
//     payload = await request.json();
//   } catch {
//     return jsonResponse({ success: false, message: "Invalid JSON body" }, 400);
//   }

//   try {
//     const lookupFilters = buildOrderSyncLookup(payload);

//     if (lookupFilters.length === 0) {
//       return jsonResponse(
//         {
//           success: false,
//           message:
//             "One of netsuiteOrderId, orderId, shopifyOrderId, shopifyOrderName, or orderName is required",
//         },
//         400
//       );
//     }

//     orderSync = await prisma.orderSync.findFirst({
//       where: {
//         OR: lookupFilters,
//       },
//     });

//     if (!orderSync && !payload.shopifyOrderId && !payload.shopify_order_id) {
//       return jsonResponse(
//         { success: false, message: "OrderSync record not found for fulfillment payload" },
//         404
//       );
//     }

//     const shopifyOrderId = getShopifyOrderId(orderSync, payload);

//     if (!shopifyOrderId) {
//       return jsonResponse(
//         { success: false, message: "Shopify order ID is missing for this fulfillment" },
//         400
//       );
//     }

//     const shopDomain = process.env.SHOP;
//     const session = await sessionStorage.loadSession(`offline_${shopDomain}`);

//     if (!session) {
//       throw new Error("Offline Shopify session not found");
//     }

//     const admin = createAdminApiClient({
//       storeDomain: shopDomain,
//       apiVersion: SHOPIFY_CONFIG.apiVersions.adminGraphql,
//       accessToken: session.accessToken,
//     });

//     if (orderSync) { 
//       await prisma.orderSyncLog.create({
//         data: {
//           orderSyncId: orderSync.id,
//           sourceSystem: SYSTEM.NETSUITE,
//           direction: DIRECTION.NETSUITE_TO_SHOPIFY,
//           eventType: EVENT_TYPE.FULFILL,
//           status: STATUS.RECEIVED,
//           rawPayload: payload,
//         },
//       });
//     }

//     const result = await fulfillOrderFromNetSuite(admin, shopifyOrderId, payload);

//     if (orderSync) {
//       await prisma.orderSync.update({
//         where: { id: orderSync.id },
//         data: {
//           lastSyncedFrom: SYSTEM.NETSUITE,
//           status: STATUS.SUCCESS,
//           action: EVENT_TYPE.FULFILL,
//           errorMessage: null,
//         },
//       });

//       await prisma.orderSyncLog.create({
//         data: {
//           orderSyncId: orderSync.id,
//           sourceSystem: SYSTEM.NETSUITE,
//           direction: DIRECTION.NETSUITE_TO_SHOPIFY,
//           eventType: EVENT_TYPE.FULFILL,
//           status: STATUS.SUCCESS,
//           message: "Shopify fulfillment created from NetSuite payload",
//           requestPayload: payload,
//           responsePayload: JSON.parse(JSON.stringify(result)),
//         },
//       });
//     }

//     return jsonResponse({
//       success: true,
//       shopifyOrderId: toShopifyOrderGid(shopifyOrderId),
//       shopifyOrderName: result.order.name,
//       fulfillments: result.fulfillments.map((entry) => entry.fulfillment),
//     });
//   } catch (error) {
//     console.error("[NetSuite Fulfillment] Failed:", error);

//     if (orderSync) {
//       await prisma.orderSync.update({
//         where: { id: orderSync.id },
//         data: {
//           status: STATUS.FAILED,
//           action: EVENT_TYPE.FULFILL,
//           errorMessage: error.message,
//         },
//       });

//       await prisma.orderSyncLog.create({
//         data: {
//           orderSyncId: orderSync.id,
//           sourceSystem: SYSTEM.NETSUITE,
//           direction: DIRECTION.NETSUITE_TO_SHOPIFY,
//           eventType: EVENT_TYPE.FULFILL,
//           status: STATUS.FAILED,
//           message: error.message,
//           requestPayload: payload || {},
//           errorPayload: {
//             message: error.message,
//             stack: error.stack,
//           },
//         },
//       });
//     }

//     return jsonResponse(
//       {
//         success: false,
//         message: error.message,
//       },
//       500
//     );
//   }
// }

export async function action({ request }) {
  let payload = null;
  let orderSync = null;

  const operationId = `FUL-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  console.log("[NetSuite Fulfillment] START", JSON.stringify({
    operationId,
    method: request.method,
  }, null, 2));

  if (request.method !== "POST") {
    console.warn("[NetSuite Fulfillment] Method not allowed", JSON.stringify({
      operationId,
      method: request.method,
    }, null, 2));

    return jsonResponse({
      success: false,
      message: "Method not allowed",
    }, 405);
  }

  try {
    payload = await request.json();

    console.log("[NetSuite Fulfillment] Request payload received", JSON.stringify({
      operationId,
      payload,
    }, null, 2));
  } catch (error) {
    console.error("[NetSuite Fulfillment] Invalid JSON body", JSON.stringify({
      operationId,
      errorName: error?.name || null,
      errorMessage: error?.message || null,
      errorStack: error?.stack || null,
    }, null, 2));

    return jsonResponse({
      success: false,
      message: "Invalid JSON body",
    }, 400);
  }

  try {
    // Build OrderSync lookup
    const lookupFilters = buildOrderSyncLookup(payload);

    console.log("[NetSuite Fulfillment] OrderSync lookup filters", JSON.stringify({
      operationId,
      lookupFilters,
    }, null, 2));

    if (lookupFilters.length === 0) {
      console.warn("[NetSuite Fulfillment] No valid order lookup identifier", JSON.stringify({
        operationId,
        payload,
      }, null, 2));

      return jsonResponse({
        success: false,
        message: "One of netsuiteOrderId, orderId, shopifyOrderId, shopifyOrderName, or orderName is required",
      }, 400);
    }

    // Find OrderSync record
    console.log("[NetSuite Fulfillment] Searching OrderSync record", JSON.stringify({
      operationId,
      lookupFilters,
    }, null, 2));

    orderSync = await prisma.orderSync.findFirst({
      where: { OR: lookupFilters },
    });

    console.log("[NetSuite Fulfillment] OrderSync lookup completed", JSON.stringify({
      operationId,
      found: Boolean(orderSync),
      orderSyncId: orderSync?.id || null,
      shopifyOrderId: orderSync?.shopifyOrderId || null,
      netsuiteOrderId: orderSync?.netsuiteOrderId || null,
      status: orderSync?.status || null,
    }, null, 2));

    if (!orderSync && !payload.shopifyOrderId && !payload.shopify_order_id) {
      console.warn("[NetSuite Fulfillment] OrderSync record not found", JSON.stringify({
        operationId,
        lookupFilters,
        payload,
      }, null, 2));

      return jsonResponse({
        success: false,
        message: "OrderSync record not found for fulfillment payload",
      }, 404);
    }

    // Resolve Shopify order ID
    const shopifyOrderId = getShopifyOrderId(orderSync, payload);

    console.log("[NetSuite Fulfillment] Shopify order ID resolved", JSON.stringify({
      operationId,
      shopifyOrderId,
      source: orderSync ? "OrderSync record / payload" : "payload",
    }, null, 2));

    if (!shopifyOrderId) {
      console.error("[NetSuite Fulfillment] Shopify order ID missing", JSON.stringify({
        operationId,
        orderSyncId: orderSync?.id || null,
        payload,
      }, null, 2));

      return jsonResponse({
        success: false,
        message: "Shopify order ID is missing for this fulfillment",
      }, 400);
    }

    // Shopify session
    const shopDomain = process.env.SHOP;

    console.log("[NetSuite Fulfillment] Loading Shopify offline session", JSON.stringify({
      operationId,
      shopDomain,
      sessionKey: `offline_${shopDomain}`,
    }, null, 2));

    const session = await sessionStorage.loadSession(`offline_${shopDomain}`);

    if (!session) {
      console.error("[NetSuite Fulfillment] Offline Shopify session not found", JSON.stringify({
        operationId,
        shopDomain,
        sessionKey: `offline_${shopDomain}`,
      }, null, 2));

      throw new Error("Offline Shopify session not found");
    }

    console.log("[NetSuite Fulfillment] Shopify offline session found", JSON.stringify({
      operationId,
      shopDomain,
      sessionId: session.id || null,
      hasAccessToken: Boolean(session.accessToken),
    }, null, 2));

    // Shopify Admin API client
    const admin = createAdminApiClient({
      storeDomain: shopDomain,
      apiVersion: SHOPIFY_CONFIG.apiVersions.adminGraphql,
      accessToken: session.accessToken,
    });

    console.log("[NetSuite Fulfillment] Shopify Admin API client created", JSON.stringify({
      operationId,
      shopDomain,
      apiVersion: SHOPIFY_CONFIG.apiVersions.adminGraphql,
    }, null, 2));

    // Create RECEIVED log
    if (orderSync) {
      console.log("[NetSuite Fulfillment] Creating RECEIVED OrderSyncLog", JSON.stringify({
        operationId,
        orderSyncId: orderSync.id,
      }, null, 2));

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

      console.log("[NetSuite Fulfillment] RECEIVED OrderSyncLog created", JSON.stringify({
        operationId,
        orderSyncId: orderSync.id,
      }, null, 2));
    } else {
      console.log("[NetSuite Fulfillment] No OrderSync record; skipping RECEIVED log", JSON.stringify({
        operationId,
        shopifyOrderId,
      }, null, 2));
    }

    // Call fulfillment service
    console.log("[NetSuite Fulfillment] Calling fulfillOrderFromNetSuite", JSON.stringify({
      operationId,
      shopifyOrderId,
      orderSyncId: orderSync?.id || null,
    }, null, 2));

    const result = await fulfillOrderFromNetSuite(admin, shopifyOrderId, payload);

    console.log("[NetSuite Fulfillment] fulfillOrderFromNetSuite completed", JSON.stringify({
      operationId,
      shopifyOrderId,
      orderId: result?.order?.id || null,
      orderName: result?.order?.name || null,
      fulfillmentCount: result?.fulfillments?.length || 0,
      fulfillmentIds: result?.fulfillments?.map(
        entry => entry?.fulfillment?.id || null
      ) || [],
    }, null, 2));

    // Update OrderSync success
    if (orderSync) {
      console.log("[NetSuite Fulfillment] Updating OrderSync as SUCCESS", JSON.stringify({
        operationId,
        orderSyncId: orderSync.id,
      }, null, 2));

      await prisma.orderSync.update({
        where: { id: orderSync.id },
        data: {
          lastSyncedFrom: SYSTEM.NETSUITE,
          status: STATUS.SUCCESS,
          action: EVENT_TYPE.FULFILL,
          errorMessage: null,
        },
      });

      console.log("[NetSuite Fulfillment] OrderSync updated as SUCCESS", JSON.stringify({
        operationId,
        orderSyncId: orderSync.id,
      }, null, 2));

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

      console.log("[NetSuite Fulfillment] SUCCESS OrderSyncLog created", JSON.stringify({
        operationId,
        orderSyncId: orderSync.id,
      }, null, 2));
    }

    // Final success
    console.log("[NetSuite Fulfillment] SUCCESS", JSON.stringify({
      operationId,
      shopifyOrderId: toShopifyOrderGid(shopifyOrderId),
      shopifyOrderName: result.order.name,
      fulfillmentCount: result.fulfillments.length,
      fulfillmentIds: result.fulfillments.map(
        entry => entry?.fulfillment?.id || null
      ),
    }, null, 2));

    return jsonResponse({
      success: true,
      shopifyOrderId: toShopifyOrderGid(shopifyOrderId),
      shopifyOrderName: result.order.name,
      fulfillments: result.fulfillments.map(
        entry => entry.fulfillment
      ),
    });
  } catch (error) {
    console.error("[NetSuite Fulfillment] FAILED", JSON.stringify({
      operationId,
      shopifyOrderId:
        orderSync?.shopifyOrderId ||
        payload?.shopifyOrderId ||
        payload?.shopify_order_id ||
        null,
      orderSyncId: orderSync?.id || null,
      netsuiteOrderId:
        orderSync?.netsuiteOrderId ||
        payload?.netsuiteOrderId ||
        payload?.netsuite_order_id ||
        null,
      errorName: error?.name || null,
      errorMessage: error?.message || null,
      errorStack: error?.stack || null,
      payload,
    }, null, 2));

    // Safe database failure logging
    if (orderSync) {
      try {
        console.log("[NetSuite Fulfillment] Updating OrderSync as FAILED", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
        }, null, 2));

        await prisma.orderSync.update({
          where: { id: orderSync.id },
          data: {
            status: STATUS.FAILED,
            action: EVENT_TYPE.FULFILL,
            errorMessage: error.message,
          },
        });

        console.log("[NetSuite Fulfillment] OrderSync updated as FAILED", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
        }, null, 2));
      } catch (dbUpdateError) {
        console.error("[NetSuite Fulfillment] FAILED to update OrderSync failure status", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
          originalError: error?.message || null,
          dbError: dbUpdateError?.message || null,
          dbErrorStack: dbUpdateError?.stack || null,
        }, null, 2));
      }

      try {
        console.log("[NetSuite Fulfillment] Creating FAILED OrderSyncLog", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
        }, null, 2));

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

        console.log("[NetSuite Fulfillment] FAILED OrderSyncLog created", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
        }, null, 2));
      } catch (dbLogError) {
        console.error("[NetSuite Fulfillment] FAILED to create failure OrderSyncLog", JSON.stringify({
          operationId,
          orderSyncId: orderSync.id,
          originalError: error?.message || null,
          dbError: dbLogError?.message || null,
          dbErrorStack: dbLogError?.stack || null,
        }, null, 2));
      }
    } else {
      console.warn("[NetSuite Fulfillment] No OrderSync record available for failure logging", JSON.stringify({
        operationId,
        errorMessage: error?.message || null,
        payload,
      }, null, 2));
    }

    console.error("[NetSuite Fulfillment] Returning 500 response", JSON.stringify({
      operationId,
      message: error?.message || "Unknown error",
    }, null, 2));

    return jsonResponse({
      success: false,
      message: error.message,
    }, 500);
  }
}