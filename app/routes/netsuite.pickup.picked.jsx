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
  const operationId = `PICKED-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  let payload = null;
  let orderSync = null;
  let shopifyOrderId = null;
  let orderName = null;
  let fulfillmentOrderId = null;

  console.log("[NetSuite Store Pickup] PICKED UP START", {
    operationId,
    method: request.method,
  });

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
    // Read request
    // -----------------------------------------
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          message: "Invalid JSON body",
        },
        400
      );
    }

    orderName = String(payload.shopifyOrderName || "" ).trim();

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
    orderSync = await prisma.orderSync.findFirst({
      where: {
        shopifyOrderName: orderName,
      },
    });

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

    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.FULFILL,
        status: STATUS.RECEIVED,
        message:
          "Store pickup picked-up request received from NetSuite",
        rawPayload: payload,
      },
    });

    // -----------------------------------------
    // Shopify Order ID
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

    // -----------------------------------------
    // Shopify Admin
    // -----------------------------------------
    const { admin } = await unauthenticated.admin(process.env.SHOP);

    // -----------------------------------------
    // Get pickup fulfillment order
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

    if (fulfillmentOrdersData.errors?.length) {
      throw new Error(
        fulfillmentOrdersData.errors
          .map((error) => error.message)
          .join(", ")
      );
    }

    const order =
      fulfillmentOrdersData.data?.order;

    if (!order) {
      throw new Error("Shopify order not found");
    }

    const fulfillmentOrders =
      order.fulfillmentOrders?.nodes || [];

    const pickupFulfillmentOrders =
      fulfillmentOrders.filter(
        (fulfillmentOrder) => {
          const hasRemainingItems =
            fulfillmentOrder.lineItems.nodes.some(
              (lineItem) =>
                Number(lineItem.remainingQuantity) > 0
            );

          return (
            fulfillmentOrder.status === "OPEN" &&
            hasRemainingItems &&
            fulfillmentOrder.deliveryMethod
              ?.methodType === "PICK_UP"
          );
        }
      );

    if (pickupFulfillmentOrders.length === 0) {
      throw new Error(
        "No open pickup fulfillment order found"
      );
    }

    if (pickupFulfillmentOrders.length > 1) {
      throw new Error(
        `Expected one pickup fulfillment order, found ${pickupFulfillmentOrders.length}`
      );
    }

    fulfillmentOrderId =
      pickupFulfillmentOrders[0].id;

    // -----------------------------------------
    // Mark pickup as fulfilled / picked up
    // -----------------------------------------
    const fulfillmentCreateMutation = `#graphql
      mutation FulfillmentCreate(
        $fulfillment: FulfillmentInput!
      ) {
        fulfillmentCreate(
          fulfillment: $fulfillment
        ) {
          fulfillment {
            id
            status
            displayStatus
            createdAt
          }

          userErrors {
            field
            message
          }
        }
      }
    `;

    const fulfillmentResponse =
      await admin.graphql(
        fulfillmentCreateMutation,
        {
          variables: {
            fulfillment: {
              lineItemsByFulfillmentOrder: [
                {
                  fulfillmentOrderId,
                },
              ],
              notifyCustomer: true,
            },
          },
        }
      );

    const fulfillmentData =
      await fulfillmentResponse.json();

    if (fulfillmentData.errors?.length) {
      throw new Error(
        fulfillmentData.errors
          .map((error) => error.message)
          .join(", ")
      );
    }

    const result =
      fulfillmentData.data?.fulfillmentCreate;

    if (!result) {
      throw new Error(
        "Shopify did not return fulfillmentCreate response"
      );
    }

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

      throw new Error(message);
    }

    if (!result.fulfillment) {
      throw new Error(
        "Shopify did not return created fulfillment"
      );
    }

    // -----------------------------------------
    // SUCCESS LOG
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.FULFILL,
        status: STATUS.SUCCESS,
        message:
          "Store pickup order marked as picked up",
        requestPayload: payload,
        responsePayload: JSON.parse(
          JSON.stringify(result)
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

    console.log(
      "[NetSuite Store Pickup] PICKED UP SUCCESS",
      {
        operationId,
        orderName,
        shopifyOrderId,
        fulfillmentOrderId,
        fulfillmentId:
          result.fulfillment.id,
        fulfillmentStatus:
          result.fulfillment.status,
      }
    );

    return jsonResponse({
      success: true,
      message: "Order marked as picked up",
      shopifyOrderId,
      shopifyOrderName: order.name,
      fulfillmentOrderId,
      fulfillmentId: result.fulfillment.id,
      fulfillmentStatus:
        result.fulfillment.status,
      displayStatus:
        result.fulfillment.displayStatus,
    });
  } catch (error) {
    console.error(
      "[NetSuite Store Pickup] PICKED UP FAILED",
      {
        operationId,
        orderSyncId: orderSync?.id || null,
        orderName,
        shopifyOrderId,
        fulfillmentOrderId,
        errorMessage: error?.message,
        errorStack: error?.stack,
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
              error?.message ||
              "Store pickup picked-up failed",
          },
        });

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
              "Store pickup picked-up failed",
            requestPayload: payload || {},
            errorPayload: {
              message:
                error?.message || null,
              stack:
                error?.stack || null,
            },
          },
        });
      } catch (dbError) {
        console.error(
          "[NetSuite Store Pickup] Failed to write failure log",
          {
            operationId,
            error: dbError?.message,
          }
        );
      }
    }

    return jsonResponse(
      {
        success: false,
        message:
          error?.message ||
          "Failed to mark order as picked up",
      },
      500
    );
  }
}