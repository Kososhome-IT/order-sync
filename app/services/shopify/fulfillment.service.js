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

export async function getOrderFulfillmentOrders(admin, shopifyOrderId) {
  const orderId = toShopifyOrderGid(shopifyOrderId);
  const response = await admin.request(ORDER_FULFILLMENT_ORDERS_QUERY, {
    variables: { orderId },
  });
  const order = response?.data?.order;

  if (!order) {
    throw new Error(`Shopify order not found: ${orderId}`);
  }

  return {
    order,
    fulfillmentOrders: order.fulfillmentOrders.nodes,
    rawResponse: response,
  };
}

export async function createFulfillment(admin, fulfillment, message) {
  const response = await admin.request(FULFILLMENT_CREATE_MUTATION, {
    variables: {
      fulfillment,
      message: message || null,
    },
  });
  const result = response?.data?.fulfillmentCreate;
  const userErrors = result?.userErrors || [];

  if (!result) {
    throw new Error("Shopify returned no fulfillmentCreate data");
  }

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  return {
    fulfillment: result.fulfillment,
    rawResponse: response,
  };
}

export async function fulfillOrderFromNetSuite(admin, shopifyOrderId, payload) {
  const { order, fulfillmentOrders ,rawResponse} = await getOrderFulfillmentOrders(admin, shopifyOrderId);

  console.log("order response : ", JSON.stringify(rawResponse,null,2));
  console.dir({ 
    DEBUG_SHOPIFY_RESPONSE: {
      orderName: order?.name,
      fulfillmentOrders: fulfillmentOrders 
    }
  }, { depth: null, colors: true });
  const requestedItems = payload.items || payload.lineItems || payload.fulfillmentItems || [];
  const lineItemsByFulfillmentOrder =
    requestedItems.length > 0
      ? buildLineItemsForRequestedSkus(fulfillmentOrders, requestedItems)
      : buildLineItemsForAllRemaining(fulfillmentOrders);

  if (lineItemsByFulfillmentOrder.length === 0) {
    throw new Error(`No fulfillable items found for Shopify order ${order.name}`);
  }

  const trackingInfo = buildTrackingInfo(payload);
  const notifyCustomer = Boolean(payload.notifyCustomer ?? payload.notify_customer ?? false);
  const message =
    payload.message ||
    payload.memo ||
    `Fulfillment created from NetSuite${payload.fulfillmentId ? ` ${payload.fulfillmentId}` : ""}`;
  const fulfillments = [];

  for (const locationGroup of groupByLocation(lineItemsByFulfillmentOrder)) {
    const fulfillmentInput = {
      lineItemsByFulfillmentOrder: locationGroup,
      notifyCustomer,
      ...(trackingInfo ? { trackingInfo } : {}),
    };
    const result = await createFulfillment(admin, fulfillmentInput, message);

    fulfillments.push({
      input: fulfillmentInput,
      fulfillment: result.fulfillment,
      response: result.rawResponse,
    });
  }

  return {
    order,
    fulfillments,
  };
}
