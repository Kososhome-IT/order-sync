const ORDER_FULFILLMENT_ORDERS_QUERY = `#graphql
  query orderFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      fulfillmentOrders(first: 50) {
        nodes {
          id
          status
          requestStatus
          assignedLocation {
            location {
              id
              name
            }
          }
          lineItems(first: 250) {
            nodes {
              id
              remainingQuantity
              lineItem {
                id
                sku
                name
              }
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation fulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
    fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
      fulfillment {
        id
        status
        createdAt
        trackingInfo {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function normalizeSku(sku) {
  return String(sku || "").trim();
}

function normalizeRequestedItems(items = []) {
  const requestedBySku = new Map();

  for (const item of items) {
    const sku = normalizeSku(item.sku);
    const quantity = Number(item.quantity ?? item.fulfilledQuantity ?? item.qty);

    if (!sku) {
      throw new Error("Each fulfillment item must include sku");
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Fulfillment quantity must be greater than 0 for SKU ${sku}`);
    }

    requestedBySku.set(sku, (requestedBySku.get(sku) || 0) + quantity);
  }

  return requestedBySku;
}

function getFulfillmentOrderLineSku(lineItem) {
  return normalizeSku(lineItem.lineItem?.sku);
}

function isFulfillableOrder(fulfillmentOrder) {
  if (["CLOSED", "CANCELLED", "CANCELED", "INCOMPLETE"].includes(fulfillmentOrder.status)) {
    return false;
  }

  return fulfillmentOrder.lineItems.nodes.some(
    (lineItem) => Number(lineItem.remainingQuantity || 0) > 0
  );
}

function groupByLocation(lineItemsByFulfillmentOrder) {
  const groups = new Map();

  for (const item of lineItemsByFulfillmentOrder) {
    const locationId = item.locationId || "UNKNOWN_LOCATION";
    const group = groups.get(locationId) || [];

    group.push({
      fulfillmentOrderId: item.fulfillmentOrderId,
      ...(item.fulfillmentOrderLineItems
        ? { fulfillmentOrderLineItems: item.fulfillmentOrderLineItems }
        : {}),
    });

    groups.set(locationId, group);
  }

  return [...groups.values()];
}

function buildLineItemsForAllRemaining(fulfillmentOrders) {
  return fulfillmentOrders
    .filter(isFulfillableOrder)
    .map((fulfillmentOrder) => ({
      locationId: fulfillmentOrder.assignedLocation?.location?.id,
      fulfillmentOrderId: fulfillmentOrder.id,
    }));
}

function buildLineItemsForRequestedSkus(fulfillmentOrders, requestedItems) {
  const requestedBySku = normalizeRequestedItems(requestedItems);
  const remainingBySku = new Map(requestedBySku);
  const lineItemsByFulfillmentOrder = [];

  for (const fulfillmentOrder of fulfillmentOrders.filter(isFulfillableOrder)) {
    const fulfillmentOrderLineItems = [];

    for (const lineItem of fulfillmentOrder.lineItems.nodes) {
      const sku = getFulfillmentOrderLineSku(lineItem);
      const requestedQuantity = remainingBySku.get(sku) || 0;
      const remainingQuantity = Number(lineItem.remainingQuantity || 0);

      if (!sku || requestedQuantity <= 0 || remainingQuantity <= 0) {
        continue;
      }

      const quantity = Math.min(requestedQuantity, remainingQuantity);

      fulfillmentOrderLineItems.push({
        id: lineItem.id,
        quantity,
      });

      remainingBySku.set(sku, requestedQuantity - quantity);
    }

    if (fulfillmentOrderLineItems.length > 0) {
      lineItemsByFulfillmentOrder.push({
        locationId: fulfillmentOrder.assignedLocation?.location?.id,
        fulfillmentOrderId: fulfillmentOrder.id,
        fulfillmentOrderLineItems,
      });
    }
  }

  const missingItems = [...remainingBySku.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([sku, quantity]) => `${sku}: ${quantity}`);

  if (missingItems.length > 0) {
    throw new Error(`Not enough fulfillable quantity in Shopify for ${missingItems.join(", ")}`);
  }

  return lineItemsByFulfillmentOrder;
}

function buildTrackingInfo(payload) {
  const trackingInfo = payload.trackingInfo || {};
  const trackingNumber = trackingInfo.number || payload.trackingNumber || payload.tracking_number;
  const trackingNumbers = trackingInfo.numbers || payload.trackingNumbers;
  const trackingUrl = trackingInfo.url || payload.trackingUrl || payload.tracking_url;
  const trackingUrls = trackingInfo.urls || payload.trackingUrls;
  const company = trackingInfo.company || payload.trackingCompany || payload.carrier;
  const result = {};

  if (company) result.company = company;
  if (trackingNumber) result.number = trackingNumber;
  if (Array.isArray(trackingNumbers) && trackingNumbers.length > 0) result.numbers = trackingNumbers;
  if (trackingUrl) result.url = trackingUrl;
  if (Array.isArray(trackingUrls) && trackingUrls.length > 0) result.urls = trackingUrls;

  return Object.keys(result).length > 0 ? result : undefined;
}

export function toShopifyOrderGid(orderId) {
  const value = String(orderId || "").trim();

  if (!value) {
    throw new Error("Shopify order ID is required");
  }

  if (value.startsWith("gid://shopify/Order/")) {
    return value;
  }

  return `gid://shopify/Order/${value}`;
}

// export async function getOrderFulfillmentOrders(admin, shopifyOrderId) {
//   const orderId = toShopifyOrderGid(shopifyOrderId);
//   const response = await admin.request(ORDER_FULFILLMENT_ORDERS_QUERY, {
//     variables: { orderId },
//   });
//   const order = response?.data?.order;

//   if (!order) {
//     throw new Error(`Shopify order not found: ${orderId}`);
//   }

//   return {
//     order,
//     fulfillmentOrders: order.fulfillmentOrders.nodes,
//     rawResponse: response,
//   };
// }

export async function getOrderFulfillmentOrders(
  admin,
  shopifyOrderId
) {
  const orderId = toShopifyOrderGid(shopifyOrderId);

  console.log(
    "[SHOPIFY ORDER LOOKUP] Starting order lookup:",
    {
      originalShopifyOrderId: shopifyOrderId,
      normalizedOrderId: orderId,
    }
  );

  try {
    const response = await admin.request(
      ORDER_FULFILLMENT_ORDERS_QUERY,
      {
        variables: {
          orderId,
        },
      }
    );

    console.log(
      "[SHOPIFY ORDER_FULFILLMENT_ORDERS_QUERY LOOKUP] Shopify API response received:",
      JSON.stringify(response, null, 2)
    );

    /*
     * -------------------------------------------------------
     * CHECK GRAPHQL TOP-LEVEL ERRORS
     * -------------------------------------------------------
     */

    if (
      response?.errors &&
      Array.isArray(response.errors) &&
      response.errors.length > 0
    ) {
      console.error(
        "[SHOPIFY ORDER_FULFILLMENT_ORDERS_QUERY LOOKUP ] GraphQL errors:",
        JSON.stringify(response.errors, null, 2)
      );

      const graphqlErrorMessage = response.errors
        .map((error) => {
          return [
            error?.message || "Unknown GraphQL error",
            error?.path
              ? `path=${JSON.stringify(error.path)}`
              : null,
            error?.extensions
              ? `extensions=${JSON.stringify(error.extensions)}`
              : null,
          ]
            .filter(Boolean)
            .join(" | ");
        })
        .join(" || ");

      throw new Error(
        `Shopify GraphQL error while fetching order ${orderId}: ${graphqlErrorMessage}`
      );
    }

    /*
     * -------------------------------------------------------
     * CHECK DATA OBJECT
     * -------------------------------------------------------
     */

    if (!response?.data) {
      console.error(
        "[SHOPIFY ORDER LOOKUP] Shopify response has no data:",
        JSON.stringify(response, null, 2)
      );

      throw new Error(
        `Shopify returned no GraphQL data while fetching order ${orderId}`
      );
    }

    /*
     * -------------------------------------------------------
     * CHECK ORDER
     * -------------------------------------------------------
     */

    const order = response.data.order;

    if (!order) {
      console.error(
        "[SHOPIFY ORDER_FULFILLMENT_ORDERS_QUERY LOOKUP] ORDER NOT FOUND",
        JSON.stringify(
          {
            originalShopifyOrderId:
              shopifyOrderId,

            normalizedOrderId:
              orderId,

            responseData:
              response.data,

            graphqlErrors:
              response.errors || null,
          },
          null,
          2
        )
      );

      throw new Error(
        `Shopify order not found: ${orderId}`
      );
    }

    /*
     * -------------------------------------------------------
     * SUCCESS
     * -------------------------------------------------------
     */

    const fulfillmentOrders =
      order.fulfillmentOrders?.nodes || [];

    console.log(
      "[SHOPIFY ORDER_FULFILLMENT_ORDERS_QUERY LOOKUP] Order found:",
      JSON.stringify(
        {
          orderId: order.id,
          orderName: order.name,
          fulfillmentOrderCount:
            fulfillmentOrders.length,
        },
        null,
        2
      )
    );

    return {
      order,
      fulfillmentOrders,
      rawResponse: response,
    };
  } catch (error) {
    console.error(
      "[SHOPIFY ORDER_FULFILLMENT_ORDERS_QUERY LOOKUP] FAILED",
      JSON.stringify(
        {
          originalShopifyOrderId:
            shopifyOrderId,

          normalizedOrderId:
            orderId,

          errorName:
            error?.name || null,

          errorMessage:
            error?.message || null,

          errorStack:
            error?.stack || null,
        },
        null,
        2
      )
    );

    throw error;
  }
}


// export async function createFulfillment(admin, fulfillment, message) {
//   const response = await admin.request(FULFILLMENT_CREATE_MUTATION, {
//     variables: {
//       fulfillment,
//       message: message || null,
//     },
//   });
//   const result = response?.data?.fulfillmentCreate;
//   const userErrors = result?.userErrors || [];

//   if (!result) {
//     throw new Error("Shopify returned no fulfillmentCreate data");
//   }

//   if (userErrors.length > 0) {
//     throw new Error(userErrors.map((error) => error.message).join(", "));
//   }

//   return {
//     fulfillment: result.fulfillment,
//     rawResponse: response,
//   };
// }

export async function createFulfillment(admin, fulfillment, message) {
  console.log(
    "[SHOPIFY FULFILLMENT CREATE] Starting fulfillment creation",
    JSON.stringify(
      {
        fulfillment,
        message: message || null,
      },
      null,
      2
    )
  );

  try {
    const response = await admin.request(
      FULFILLMENT_CREATE_MUTATION,
      {
        variables: {
          fulfillment,
          message: message || null,
        },
      }
    );

    console.log(
      "[SHOPIFY FULFILLMENT CREATE] Shopify response received",
      JSON.stringify(response, null, 2)
    );

    // GraphQL top-level errors
    if (
      response?.errors &&
      Array.isArray(response.errors) &&
      response.errors.length > 0
    ) {
      console.error(
        "[SHOPIFY FULFILLMENT CREATE] GraphQL errors",
        JSON.stringify(response.errors, null, 2)
      );

      const graphqlErrorMessage = response.errors
        .map((error) => {
          const field = error?.path
            ? `path=${JSON.stringify(error.path)}`
            : "";

          const extensions = error?.extensions
            ? `extensions=${JSON.stringify(error.extensions)}`
            : "";

          return [
            error?.message || "Unknown GraphQL error",
            field,
            extensions,
          ]
            .filter(Boolean)
            .join(" | ");
        })
        .join(" || ");

      throw new Error(
        `Shopify GraphQL error: ${graphqlErrorMessage}`
      );
    }

    const result =
      response?.data?.fulfillmentCreate;

    // No mutation result
    if (!result) {
      console.error(
        "[SHOPIFY FULFILLMENT CREATE] No fulfillmentCreate data",
        JSON.stringify(
          {
            fulfillment,
            message: message || null,
            response,
          },
          null,
          2
        )
      );

      throw new Error(
        "Shopify returned no fulfillmentCreate data"
      );
    }

    const userErrors =
      result.userErrors || [];

    // Shopify mutation user errors
    if (userErrors.length > 0) {
      console.error(
        "[SHOPIFY FULFILLMENT CREATE] Shopify userErrors",
        JSON.stringify(
          {
            userErrors,
            fulfillment,
            message: message || null,
          },
          null,
          2
        )
      );

      const errorMessage = userErrors
        .map((error) => {
          const field = Array.isArray(error.field)
            ? error.field.join(".")
            : error.field || "unknown";

          return `${field}: ${error.message}`;
        })
        .join(" | ");

      throw new Error(
        `Shopify fulfillment error: ${errorMessage}`
      );
    }

    // Safety check
    if (!result.fulfillment) {
      console.error(
        "[SHOPIFY FULFILLMENT CREATE] No fulfillment object returned",
        JSON.stringify(
          {
            result,
            response,
          },
          null,
          2
        )
      );

      throw new Error(
        "Shopify fulfillment was not created"
      );
    }

    console.log(
      "[SHOPIFY FULFILLMENT CREATE] Fulfillment created successfully",
      JSON.stringify(
        {
          fulfillmentId:
            result.fulfillment.id,

          status:
            result.fulfillment.status,

          createdAt:
            result.fulfillment.createdAt,

          trackingInfo:
            result.fulfillment.trackingInfo,
        },
        null,
        2
      )
    );

    return {
      fulfillment: result.fulfillment,
      rawResponse: response,
    };
  } catch (error) {
    console.error(
      "[SHOPIFY FULFILLMENT CREATE] FAILED",
      JSON.stringify(
        {
          errorName:
            error?.name || null,

          errorMessage:
            error?.message || null,

          errorStack:
            error?.stack || null,

          fulfillment,
          message: message || null,
        },
        null,
        2
      )
    );

    throw error;
  }
}

// export async function fulfillOrderFromNetSuite(admin, shopifyOrderId, payload) {
//   const { order, fulfillmentOrders ,rawResponse} = await getOrderFulfillmentOrders(admin, shopifyOrderId);

//   // console.log("order response : ", JSON.stringify(rawResponse,null,2));
//   console.dir({ 
//     DEBUG_SHOPIFY_RESPONSE: {
//       orderName: order?.name,
//       fulfillmentOrders: fulfillmentOrders 
//     }
//   }, { depth: null, colors: true });
//   const requestedItems = payload.items || payload.lineItems || payload.fulfillmentItems || [];
//   const lineItemsByFulfillmentOrder =
//     requestedItems.length > 0
//       ? buildLineItemsForRequestedSkus(fulfillmentOrders, requestedItems)
//       : buildLineItemsForAllRemaining(fulfillmentOrders);

//   if (lineItemsByFulfillmentOrder.length === 0) {
//     throw new Error(`No fulfillable items found for Shopify order ${order.name}`);
//   }

//   const trackingInfo = buildTrackingInfo(payload);
//   const notifyCustomer = Boolean(payload.notifyCustomer ?? payload.notify_customer ?? false);
//   const message =
//     payload.message ||
//     payload.memo ||
//     `Fulfillment created from NetSuite${payload.fulfillmentId ? ` ${payload.fulfillmentId}` : ""}`;
//   const fulfillments = [];

//   for (const locationGroup of groupByLocation(lineItemsByFulfillmentOrder)) {
//     const fulfillmentInput = {
//       lineItemsByFulfillmentOrder: locationGroup,
//       notifyCustomer,
//       ...(trackingInfo ? { trackingInfo } : {}),
//     };
//     const result = await createFulfillment(admin, fulfillmentInput, message);

//     fulfillments.push({
//       input: fulfillmentInput,
//       fulfillment: result.fulfillment,
//       response: result.rawResponse,
//     });
//   }

//   return {
//     order,
//     fulfillments,
//   };
// }

export async function fulfillOrderFromNetSuite(admin, shopifyOrderId, payload) {
  console.log("[FULFILLMENT FLOW] START", JSON.stringify({ shopifyOrderId, payload }, null, 2));

  try {
    const { order, fulfillmentOrders, rawResponse } = await getOrderFulfillmentOrders(admin, shopifyOrderId);

    console.log("[FULFILLMENT FLOW] Shopify order loaded", JSON.stringify({
      shopifyOrderId, orderId: order?.id, orderName: order?.name,
      fulfillmentOrderCount: fulfillmentOrders?.length || 0,
    }, null, 2));

    console.dir({ DEBUG_SHOPIFY_RESPONSE: { orderName: order?.name, fulfillmentOrders } }, { depth: null, colors: true });

    const requestedItems = payload.items || payload.lineItems || payload.fulfillmentItems || [];

    console.log("[FULFILLMENT FLOW] Requested items", JSON.stringify({
      requestedItems, itemCount: requestedItems.length,
    }, null, 2));

    const fulfillmentMode = requestedItems.length > 0 ? "PARTIAL" : "FULL";

    console.log("[FULFILLMENT FLOW] Fulfillment mode", JSON.stringify({
      mode: fulfillmentMode,
      reason: requestedItems.length > 0
        ? "Requested items were provided"
        : "No requested items were provided; fulfilling all remaining items",
    }, null, 2));

    const lineItemsByFulfillmentOrder = requestedItems.length > 0
      ? buildLineItemsForRequestedSkus(fulfillmentOrders, requestedItems)
      : buildLineItemsForAllRemaining(fulfillmentOrders);

    console.log("[FULFILLMENT FLOW] Line items prepared", JSON.stringify({
      mode: fulfillmentMode, lineItemsByFulfillmentOrder,
      count: lineItemsByFulfillmentOrder.length,
    }, null, 2));

    if (lineItemsByFulfillmentOrder.length === 0) {
      console.error("[FULFILLMENT FLOW] NO FULFILLABLE ITEMS", JSON.stringify({
        shopifyOrderId, orderId: order?.id, orderName: order?.name,
        requestedItems, fulfillmentOrders, lineItemsByFulfillmentOrder,
      }, null, 2));

      throw new Error(`No fulfillable items found for Shopify order ${order.name}`);
    }

    const trackingInfo = buildTrackingInfo(payload);
    const notifyCustomer = Boolean(payload.notifyCustomer ?? payload.notify_customer ?? false);
    const message = payload.message || payload.memo ||
      `Fulfillment created from NetSuite${payload.fulfillmentId ? ` ${payload.fulfillmentId}` : ""}`;

    console.log("[FULFILLMENT FLOW] Fulfillment options prepared", JSON.stringify({
      trackingInfo, notifyCustomer, message,
      fulfillmentId: payload.fulfillmentId || null,
    }, null, 2));

    const fulfillments = [];
    const locationGroups = groupByLocation(lineItemsByFulfillmentOrder);

    console.log("[FULFILLMENT FLOW] Location groups created", JSON.stringify({
      locationGroupCount: locationGroups.length, locationGroups,
    }, null, 2));

    for (const locationGroup of locationGroups) {
      console.log("[FULFILLMENT FLOW] Processing location group", JSON.stringify({
        locationGroup,
      }, null, 2));

      const fulfillmentInput = {
        lineItemsByFulfillmentOrder: locationGroup,
        notifyCustomer,
        ...(trackingInfo ? { trackingInfo } : {}),
      };

      console.log("[FULFILLMENT FLOW] Fulfillment input prepared", JSON.stringify({
        fulfillmentInput, message,
      }, null, 2));

      const result = await createFulfillment(admin, fulfillmentInput, message);

      console.log("[FULFILLMENT FLOW] Location fulfillment created", JSON.stringify({
        fulfillmentId: result?.fulfillment?.id || null,
        status: result?.fulfillment?.status || null,
        createdAt: result?.fulfillment?.createdAt || null,
        locationGroup,
      }, null, 2));

      fulfillments.push({
        input: fulfillmentInput,
        fulfillment: result.fulfillment,
        response: result.rawResponse,
      });
    }

    console.log("[FULFILLMENT FLOW] SUCCESS", JSON.stringify({
      shopifyOrderId, orderId: order?.id, orderName: order?.name,
      fulfillmentCount: fulfillments.length,
      fulfillmentIds: fulfillments.map(item => item.fulfillment?.id || null),
    }, null, 2));

    return { order, fulfillments };
  } catch (error) {
    console.error("[FULFILLMENT FLOW] FAILED", JSON.stringify({
      shopifyOrderId,
      errorName: error?.name || null,
      errorMessage: error?.message || null,
      errorStack: error?.stack || null,
      payload,
    }, null, 2));

    throw error;
  }
}