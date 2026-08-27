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
  let fulfillmentOrderId = null;

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
    // Find OrderSync
    // -----------------------------------------
    console.log(
      "[NetSuite Store Pickup] Searching OrderSync by order name",
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
    // RECEIVED DB log
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
    // Get Shopify Order ID
    // -----------------------------------------
    shopifyOrderId = orderSync.shopifyOrderId;

    if (!shopifyOrderId) {
      throw new Error(
        "Shopify order ID is missing in OrderSync"
      );
    }

    if (
      !String(shopifyOrderId).startsWith(
        "gid://shopify/Order/"
      )
    ) {
      shopifyOrderId =
        `gid://shopify/Order/${shopifyOrderId}`;
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
    // Create Shopify Admin client
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

              deliveryMethod {
                methodType
              }

              lineItems(first: 100) {
                nodes {
                  id
                  remainingQuantity
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

    // -----------------------------------------
    // GraphQL errors
    // -----------------------------------------
    if (fulfillmentOrdersData.errors?.length) {
      const message =
        fulfillmentOrdersData.errors
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

    if (fulfillmentOrders.length === 0) {
      throw new Error(
        "No fulfillment orders found for Shopify order"
      );
    }

    // -----------------------------------------
    // Find fulfillable PICKUP fulfillment order
    // -----------------------------------------
    const pickupFulfillmentOrders =
      fulfillmentOrders.filter(
        (fulfillmentOrder) => {
          const hasRemainingItems =
            fulfillmentOrder.lineItems.nodes.some(
              (lineItem) =>
                Number(
                  lineItem.remainingQuantity
                ) > 0
            );

          return (
            fulfillmentOrder.status === "OPEN" &&
            hasRemainingItems &&
            fulfillmentOrder.deliveryMethod
              ?.methodType === "PICK_UP"
          );
        }
      );

    console.log(
      "[NetSuite Store Pickup] Pickup fulfillment orders found",
      {
        operationId,
        totalFulfillmentOrders:
          fulfillmentOrders.length,
        pickupFulfillmentOrders:
          pickupFulfillmentOrders.length,
        fulfillmentOrders:
          pickupFulfillmentOrders.map(
            (fulfillmentOrder) => ({
              id: fulfillmentOrder.id,
              status: fulfillmentOrder.status,
              methodType:
                fulfillmentOrder.deliveryMethod
                  ?.methodType || null,
              location:
                fulfillmentOrder.assignedLocation
                  ?.location?.name || null,
            })
          ),
      }
    );

    // -----------------------------------------
    // Validate exactly one pickup fulfillment order
    // -----------------------------------------
    if (
      pickupFulfillmentOrders.length === 0
    ) {
      throw new Error(
        "No open pickup fulfillment order found"
      );
    }

    if (
      pickupFulfillmentOrders.length > 1
    ) {
      throw new Error(
        `Expected one pickup fulfillment order, found ${pickupFulfillmentOrders.length}`
      );
    }

    const pickupFulfillmentOrder =
      pickupFulfillmentOrders[0];

    fulfillmentOrderId =
      pickupFulfillmentOrder.id;

    console.log(
      "[NetSuite Store Pickup] Pickup fulfillment order selected",
      {
        operationId,
        fulfillmentOrderId,
        location:
          pickupFulfillmentOrder.assignedLocation
            ?.location?.name || null,
      }
    );

    // -----------------------------------------
    // Mark ALL fulfillment order line items
    // as prepared for pickup
    // -----------------------------------------
    const preparedForPickupMutation = `#graphql
      mutation FulfillmentOrderLineItemsPreparedForPickup(
        $input: FulfillmentOrderLineItemsPreparedForPickupInput!
      ) {
        fulfillmentOrderLineItemsPreparedForPickup(
          input: $input
        ) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    console.log(
      "[NetSuite Store Pickup] Marking items prepared for pickup",
      {
        operationId,
        fulfillmentOrderId,
      }
    );

    const preparedForPickupResponse =
      await admin.graphql(
        preparedForPickupMutation,
        {
          variables: {
            input: {
              lineItemsByFulfillmentOrder: [
                {
                  fulfillmentOrderId,
                },
              ],
            },
          },
        }
      );

    const preparedForPickupData =
      await preparedForPickupResponse.json();

    console.log(
      "[NetSuite Store Pickup] Prepared for pickup response",
      {
        operationId,
        preparedForPickupData,
      }
    );

    // -----------------------------------------
    // GraphQL errors
    // -----------------------------------------
    if (
      preparedForPickupData.errors?.length
    ) {
      const message =
        preparedForPickupData.errors
          .map((error) => error.message)
          .join(", ");

      throw new Error(message);
    }

    const result =
      preparedForPickupData.data
        ?.fulfillmentOrderLineItemsPreparedForPickup;

    if (!result) {
      throw new Error(
        "Shopify did not return prepared for pickup response"
      );
    }

    // -----------------------------------------
    // Shopify user errors
    // -----------------------------------------
    if (result.userErrors?.length) {
      const message =
        result.userErrors
          .map((error) => {
            const field =
              error.field?.length
                ? `${error.field.join(".")}: `
                : "";

            return `${field}${error.message}`;
          })
          .join(", ");

      console.error(
        "[NetSuite Store Pickup] Shopify user error",
        {
          operationId,
          orderName,
          shopifyOrderId,
          fulfillmentOrderId,
          errors: result.userErrors,
        }
      );

      // Throw so FAILED logging is handled
      // by the existing catch block
      throw new Error(message);
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
        fulfillmentOrderId,
      }
    );

    // -----------------------------------------
    // SUCCESS DB log
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.FULFILL,
        status: STATUS.SUCCESS,
        message:
          "Shopify fulfillment order line items marked as prepared for pickup",
        requestPayload: payload,
        responsePayload: JSON.parse(
          JSON.stringify(result)
        ),
      },
    });

    // -----------------------------------------
    // Update OrderSync SUCCESS
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
        "Order marked as prepared for pickup",
      shopifyOrderId,
      shopifyOrderName: order.name,
      fulfillmentOrderId,
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
        fulfillmentOrderId,
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
      // -----------------------------------------
      // Update OrderSync FAILED
      // -----------------------------------------
      try {
        await prisma.orderSync.update({
          where: {
            id: orderSync.id,
          },
          data: {
            status: STATUS.FAILED,
            action: EVENT_TYPE.FULFILL,
            errorMessage:
              error?.message ||
              "Store pickup fulfillment failed",
          },
        });
      } catch (dbUpdateError) {
        console.error(
          "[NetSuite Store Pickup] Failed to update OrderSync",
          {
            operationId,
            dbError:
              dbUpdateError?.message,
          }
        );
      }

      // -----------------------------------------
      // FAILED DB log
      // -----------------------------------------
      try {
        await prisma.orderSyncLog.create({
          data: {
            orderSyncId: orderSync.id,
            sourceSystem: SYSTEM.NETSUITE,
            direction:
              DIRECTION.NETSUITE_TO_SHOPIFY,
            eventType: EVENT_TYPE.FULFILL,
            status: STATUS.FAILED,
            message:
              error?.message ||
              "Store pickup fulfillment failed",
            requestPayload:
              payload || {},
            errorPayload: {
              message:
                error?.message || null,
              stack:
                error?.stack || null,
            },
          },
        });
      } catch (dbLogError) {
        console.error(
          "[NetSuite Store Pickup] Failed to create failure log",
          {
            operationId,
            dbError:
              dbLogError?.message,
          }
        );
      }
    }

    return jsonResponse(
      {
        success: false,
        message:
          error?.message ||
          "Failed to mark order as prepared for pickup",
      },
      500
    );
  }
}