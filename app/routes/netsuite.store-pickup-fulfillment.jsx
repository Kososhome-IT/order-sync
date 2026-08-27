import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { jsonResponse } from "../utils/jsonResponse";
import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

export async function action({ request }) {
  const operationId = `PICKUP-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  let payload = null;
  let orderSync = null;
  let shopifyOrderId = null;
  let orderName = null;

  console.log("[NetSuite Store Pickup] START", {
    operationId,
    method: request.method,
  });

  // -----------------------------------------
  // Method validation
  // -----------------------------------------
  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        message: "Method not allowed",
      },
      405
    );
  }

  try {
    // -----------------------------------------
    // Read request body
    // -----------------------------------------
    try {
      payload = await request.json();
    } catch (error) {
      console.error(
        "[NetSuite Store Pickup] Invalid JSON body",
        {
          operationId,
          errorMessage: error?.message,
        }
      );

      return jsonResponse(
        {
          success: false,
          message: "Invalid JSON body",
        },
        400
      );
    }

    console.log(
      "[NetSuite Store Pickup] Request payload received",
      {
        operationId,
        payload,
      }
    );

    // -----------------------------------------
    // Get order name
    // -----------------------------------------
    orderName = String(
      payload.orderName ||
        payload.shopifyOrderName ||
        payload.order_name ||
        ""
    ).trim();

    if (!orderName) {
      return jsonResponse(
        {
          success: false,
          message: "orderName is required",
        },
        400
      );
    }

    // -----------------------------------------
    // Optional customer notification
    // Default = false
    // -----------------------------------------
    const notifyCustomer =
      payload.notifyCustomer === true;

    console.log(
      "[NetSuite Store Pickup] Notification setting",
      {
        operationId,
        notifyCustomer,
      }
    );

    // -----------------------------------------
    // Find OrderSync
    // -----------------------------------------
    console.log(
      "[NetSuite Store Pickup] Searching OrderSync",
      {
        operationId,
        orderName,
      }
    );

    orderSync = await prisma.orderSync.findFirst({
      where: {
        shopifyOrderName: orderName,
      },
    });

    console.log(
      "[NetSuite Store Pickup] OrderSync lookup completed",
      {
        operationId,
        found: Boolean(orderSync),
        orderSyncId: orderSync?.id || null,
        shopifyOrderName:
          orderSync?.shopifyOrderName || null,
        shopifyOrderId:
          orderSync?.shopifyOrderId || null,
      }
    );

    if (!orderSync) {
      return jsonResponse(
        {
          success: false,
          message: "OrderSync record not found",
          orderName,
        },
        404
      );
    }

    // -----------------------------------------
    // RECEIVED log
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.FULFILL,
        status: STATUS.RECEIVED,
        message:
          "Store pickup fulfillment request received from NetSuite",
        rawPayload: payload,
      },
    });

    // -----------------------------------------
    // Get Shopify order ID
    // -----------------------------------------
    shopifyOrderId = orderSync.shopifyOrderId;

    if (!shopifyOrderId) {
      return jsonResponse(
        {
          success: false,
          message:
            "Shopify order ID is missing in OrderSync",
          orderName,
        },
        400
      );
    }

    if (
      !shopifyOrderId.startsWith(
        "gid://shopify/Order/"
      )
    ) {
      shopifyOrderId = `gid://shopify/Order/${shopifyOrderId}`;
    }

    console.log(
      "[NetSuite Store Pickup] Shopify Order ID resolved",
      {
        operationId,
        orderName,
        shopifyOrderId,
        orderSyncId: orderSync.id,
      }
    );

    // -----------------------------------------
    // Shopify Admin API
    // -----------------------------------------
    const shopDomain = process.env.SHOP;

    console.log(
      "[NetSuite Store Pickup] Creating unauthenticated Admin client",
      {
        operationId,
        shopDomain,
      }
    );

    const { admin } =
      await unauthenticated.admin(shopDomain);

    console.log(
      "[NetSuite Store Pickup] Shopify Admin client created",
      {
        operationId,
        shopDomain,
        hasGraphql:
          typeof admin?.graphql === "function",
      }
    );

    // -----------------------------------------
    // Get fulfillment orders
    // -----------------------------------------
    const fulfillmentOrdersQuery = `#graphql
      query GetFulfillmentOrders($orderId: ID!) {
        order(id: $orderId) {
          id
          name
          displayFulfillmentStatus
          fulfillmentOrders(first: 100) {
            nodes {
              id
              status
              assignedLocation {
                location {
                  id
                  name
                }
              }
              lineItems(first: 100) {
                nodes {
                  id
                  remainingQuantity
                  lineItem {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    console.log(
      "[NetSuite Store Pickup] Fetching fulfillment orders",
      {
        operationId,
        shopifyOrderId,
      }
    );

    const fulfillmentOrdersResponse =
      await admin.graphql(
        fulfillmentOrdersQuery,
        {
          variables: {
            orderId: shopifyOrderId,
          },
        }
      );

    const fulfillmentOrdersData =
      await fulfillmentOrdersResponse.json();

    console.log(
      "[NetSuite Store Pickup] Fulfillment orders response",
      {
        operationId,
        fulfillmentOrdersData,
      }
    );

    if (fulfillmentOrdersData.errors?.length) {
      const message = fulfillmentOrdersData.errors
        .map((error) => error.message)
        .join(", ");

      throw new Error(message);
    }

    const order =
      fulfillmentOrdersData.data?.order;

    if (!order) {
      throw new Error(
        "Shopify order not found"
      );
    }

    const fulfillmentOrders =
      order.fulfillmentOrders?.nodes || [];

    // -----------------------------------------
    // Filter fulfillment orders that can be fulfilled
    // -----------------------------------------
    const fulfillableOrders =
      fulfillmentOrders.filter(
        (fulfillmentOrder) =>
          fulfillmentOrder.status === "OPEN" &&
          fulfillmentOrder.lineItems.nodes.some(
            (lineItem) =>
              Number(
                lineItem.remainingQuantity
              ) > 0
          )
      );

    console.log(
      "[NetSuite Store Pickup] Fulfillable fulfillment orders",
      {
        operationId,
        total:
          fulfillmentOrders.length,
        fulfillable:
          fulfillableOrders.length,
        fulfillmentOrderIds:
          fulfillableOrders.map(
            (entry) => entry.id
          ),
      }
    );

    // -----------------------------------------
    // Store pickup must have one fulfillment order
    // -----------------------------------------
    if (fulfillableOrders.length === 0) {
      throw new Error(
        "No fulfillable fulfillment order found for store pickup"
      );
    }

    if (fulfillableOrders.length > 1) {
      throw new Error(
        `Expected one fulfillable fulfillment order for store pickup, found ${fulfillableOrders.length}`
      );
    }

    const fulfillmentOrder =
      fulfillableOrders[0];

    // -----------------------------------------
    // Build fulfillment line items
    // -----------------------------------------
    const fulfillmentLineItems =
      fulfillmentOrder.lineItems.nodes
        .filter(
          (lineItem) =>
            Number(
              lineItem.remainingQuantity
            ) > 0
        )
        .map((lineItem) => ({
          id: lineItem.id,
          quantity: Number(
            lineItem.remainingQuantity
          ),
        }));

    if (
      fulfillmentLineItems.length === 0
    ) {
      throw new Error(
        "No fulfillable line items found for store pickup"
      );
    }

    console.log(
      "[NetSuite Store Pickup] Fulfillment line items prepared",
      {
        operationId,
        fulfillmentOrderId:
          fulfillmentOrder.id,
        location:
          fulfillmentOrder.assignedLocation
            ?.location?.name || null,
        lineItems:
          fulfillmentLineItems,
      }
    );

    // -----------------------------------------
    // Create fulfillment
    // -----------------------------------------
    const fulfillmentMutation = `#graphql
      mutation FulfillmentCreate(
        $fulfillment: FulfillmentInput!
      ) {
        fulfillmentCreate(
          fulfillment: $fulfillment
        ) {
          fulfillment {
            id
            status
            createdAt
            updatedAt
            notifyCustomer
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

    console.log(
      "[NetSuite Store Pickup] Creating fulfillment",
      {
        operationId,
        fulfillmentOrderId:
          fulfillmentOrder.id,
        notifyCustomer,
      }
    );

    const fulfillmentResponse =
      await admin.graphql(
        fulfillmentMutation,
        {
          variables: {
            fulfillment: {
              lineItemsByFulfillmentOrder: [
                {
                  fulfillmentOrderId:
                    fulfillmentOrder.id,
                  fulfillmentOrderLineItems:
                    fulfillmentLineItems,
                },
              ],
              notifyCustomer,
            },
          },
        }
      );

    const fulfillmentData =
      await fulfillmentResponse.json();

    console.log(
      "[NetSuite Store Pickup] Fulfillment response",
      {
        operationId,
        fulfillmentData,
      }
    );

    if (fulfillmentData.errors?.length) {
      const message = fulfillmentData.errors
        .map((error) => error.message)
        .join(", ");

      throw new Error(message);
    }

    const fulfillmentResult =
      fulfillmentData.data?.fulfillmentCreate;

    if (!fulfillmentResult) {
      throw new Error(
        "Shopify did not return fulfillmentCreate response"
      );
    }

    // -----------------------------------------
    // Shopify fulfillment user errors
    // -----------------------------------------
    if (
      fulfillmentResult.userErrors?.length
    ) {
      const message =
        fulfillmentResult.userErrors
          .map((error) => {
            const field =
              error.field?.length
                ? `${error.field.join(".")}: `
                : "";

            return `${field}${error.message}`;
          })
          .join(", ");

      console.error(
        "[NetSuite Store Pickup] Shopify fulfillment error",
        {
          operationId,
          orderName,
          shopifyOrderId,
          errors:
            fulfillmentResult.userErrors,
        }
      );

      throw new Error(message);
    }

    if (!fulfillmentResult.fulfillment) {
      throw new Error(
        "Shopify did not return the created fulfillment"
      );
    }

    // -----------------------------------------
    // SUCCESS
    // -----------------------------------------
    console.log(
      "[NetSuite Store Pickup] SUCCESS",
      {
        operationId,
        orderName,
        shopifyOrderId,
        fulfillmentOrderId:
          fulfillmentOrder.id,
        fulfillmentId:
          fulfillmentResult.fulfillment.id,
        status:
          fulfillmentResult.fulfillment.status,
        notifyCustomer:
          fulfillmentResult.fulfillment
            .notifyCustomer,
      }
    );

    // -----------------------------------------
    // SUCCESS log
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction:
          DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.FULFILL,
        status: STATUS.SUCCESS,
        message:
          "Shopify store pickup fulfillment created from NetSuite",
        requestPayload: payload,
        responsePayload:
          JSON.parse(
            JSON.stringify(
              fulfillmentResult
            )
          ),
      },
    });

    // -----------------------------------------
    // Update OrderSync
    // -----------------------------------------
    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        lastSyncedFrom: SYSTEM.NETSUITE,
        status: STATUS.SUCCESS,
        action: EVENT_TYPE.FULFILL,
        errorMessage: null,
      },
    });

    return jsonResponse({
      success: true,
      message:
        "Store pickup fulfillment created",
      shopifyOrderId,
      shopifyOrderName:
        order.name,
      fulfillmentOrderId:
        fulfillmentOrder.id,
      fulfillment:
        fulfillmentResult.fulfillment,
      notifyCustomer,
    });
  } catch (error) {
    // -----------------------------------------
    // FAILED
    // -----------------------------------------
    console.error(
      "[NetSuite Store Pickup] FAILED",
      {
        operationId,
        orderSyncId:
          orderSync?.id || null,
        orderName,
        shopifyOrderId,
        errorName:
          error?.name || null,
        errorMessage:
          error?.message || null,
        errorStack:
          error?.stack || null,
        payload,
      }
    );

    if (orderSync) {
      try {
        await prisma.orderSync.update({
          where: {
            id: orderSync.id,
          },
          data: {
            status: STATUS.FAILED,
            action: EVENT_TYPE.FULFILL,
            errorMessage:
              error.message,
          },
        });
      } catch (dbUpdateError) {
        console.error(
          "[NetSuite Store Pickup] Failed to update OrderSync",
          {
            operationId,
            dbError:
              dbUpdateError.message,
          }
        );
      }

      try {
        await prisma.orderSyncLog.create({
          data: {
            orderSyncId:
              orderSync.id,
            sourceSystem:
              SYSTEM.NETSUITE,
            direction:
              DIRECTION.NETSUITE_TO_SHOPIFY,
            eventType:
              EVENT_TYPE.FULFILL,
            status:
              STATUS.FAILED,
            message:
              error.message,
            requestPayload:
              payload || {},
            errorPayload: {
              message:
                error.message,
              stack:
                error.stack,
            },
          },
        });
      } catch (dbLogError) {
        console.error(
          "[NetSuite Store Pickup] Failed to create failure log",
          {
            operationId,
            dbError:
              dbLogError.message,
          }
        );
      }
    }

    return jsonResponse(
      {
        success: false,
        message:
          error?.message ||
          "Failed to create store pickup fulfillment",
      },
      500
    );
  }
}