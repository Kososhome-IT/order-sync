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
  const operationId = `PAY-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  let payload = null;
  let orderSync = null;
  let shopifyOrderId = null;
  let orderName = null;

  console.log("[NetSuite Mark Paid] START", {
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
//   security check token authorisation
// const authorization =
//   request.headers.get("Authorization");

// const expectedAuthorization =
//   `Bearer ${process.env.NETSUITE_PAYMENT_SECRET}`;

// if (
//   !authorization ||
//   authorization !== expectedAuthorization
// ) {
//   console.warn("[NetSuite Mark Paid] Unauthorized request", {
//     operationId,
//   });

//   return jsonResponse(
//     {
//       success: false,
//       message: "Unauthorized",
//     },
//     401
//   );
// }

//   security check token authorisation ends here
  try {
    // -----------------------------------------
    // Read request body
    // -----------------------------------------
    try {
      payload = await request.json();
    } catch (error) {
      console.error(
        "[NetSuite Mark Paid] Invalid JSON body",
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
      "[NetSuite Mark Paid] Request payload received",
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
    // Find OrderSync by Shopify order name
    // -----------------------------------------
    console.log(
      "[NetSuite Mark Paid] Searching OrderSync by order name",
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
      "[NetSuite Mark Paid] OrderSync lookup completed",
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
    // Create RECEIVED log
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.PAYMENT_CAPTURE,
        status: STATUS.RECEIVED,
        message: "Mark Paid request received from NetSuite",
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
      "[NetSuite Mark Paid] Shopify Order ID resolved",
      {
        operationId,
        orderName,
        shopifyOrderId,
        orderSyncId: orderSync.id,
      }
    );

    // -----------------------------------------
    // Shopify unauthenticated Admin API
    // -----------------------------------------
    const shopDomain = process.env.SHOP;

    console.log(
      "[NetSuite Mark Paid] Creating unauthenticated Admin client",
      {
        operationId,
        shopDomain,
      }
    );

    const { admin } =
      await unauthenticated.admin(shopDomain);

    console.log(
      "[NetSuite Mark Paid] Shopify Admin client created",
      {
        operationId,
        shopDomain,
        hasGraphql:
          typeof admin?.graphql === "function",
      }
    );

    // -----------------------------------------
    // Shopify orderMarkAsPaid mutation
    // -----------------------------------------
    const mutation = `#graphql
      mutation OrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
        orderMarkAsPaid(input: $input) {
          userErrors {
            field
            message
          }
          order {
            id
            name
            displayFinancialStatus
            canMarkAsPaid
          }
        }
      }
    `;

    console.log(
      "[NetSuite Mark Paid] Calling orderMarkAsPaid",
      {
        operationId,
        orderName,
        shopifyOrderId,
      }
    );

    const response = await admin.graphql(
      mutation,
      {
        variables: {
          input: {
            id: shopifyOrderId,
          },
        },
      }
    );

    // -----------------------------------------
    // Convert Shopify response to JSON
    // -----------------------------------------
    const responseData = await response.json();

    console.log(
      "[NetSuite Mark Paid] Shopify mutation response",
      {
        operationId,
        responseData,
      }
    );

    // -----------------------------------------
    // GraphQL errors
    // -----------------------------------------
    if (responseData.errors?.length) {
      const message = responseData.errors
        .map((error) => error.message)
        .join(", ");

      throw new Error(message);
    }

    // -----------------------------------------
    // Mutation result
    // -----------------------------------------
    const result =
      responseData.data?.orderMarkAsPaid;

    if (!result) {
      throw new Error(
        "Shopify did not return orderMarkAsPaid response"
      );
    }

    // -----------------------------------------
    // Shopify user errors
    // -----------------------------------------
    if (result.userErrors?.length) {
      const message = result.userErrors
        .map((error) => {
          const field = error.field?.length
            ? `${error.field.join(".")}: `
            : "";

          return `${field}${error.message}`;
        })
        .join(", ");

      console.error(
        "[NetSuite Mark Paid] Shopify user error",
        {
          operationId,
          orderName,
          shopifyOrderId,
          errors: result.userErrors,
        }
      );

      // Throw so the existing catch block
      // handles FAILED OrderSync + OrderSyncLog
      throw new Error(message);
    }

    // -----------------------------------------
    // Validate Shopify order response
    // -----------------------------------------
    if (!result.order) {
      throw new Error(
        "Shopify did not return the updated order"
      );
    }

    // -----------------------------------------
    // SUCCESS
    // -----------------------------------------
    console.log(
      "[NetSuite Mark Paid] SUCCESS",
      {
        operationId,
        orderName: result.order.name,
        shopifyOrderId: result.order.id,
        financialStatus:
          result.order.displayFinancialStatus,
        canMarkAsPaid:
          result.order.canMarkAsPaid,
      }
    );

    // -----------------------------------------
    // Create SUCCESS log
    // -----------------------------------------
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.NETSUITE_TO_SHOPIFY,
        eventType: EVENT_TYPE.PAYMENT_CAPTURE,
        status: STATUS.SUCCESS,
        message:
          "Shopify order marked as paid from NetSuite payment capture",
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
        action: EVENT_TYPE.PAYMENT_CAPTURE,
        errorMessage: null,
      },
    });

    return jsonResponse({
      success: true,
      message: "Order marked as paid",
      orderName: result.order.name,
      shopifyOrderId: result.order.id,
      financialStatus:
        result.order.displayFinancialStatus,
      canMarkAsPaid:
        result.order.canMarkAsPaid,
    });
  } catch (error) {
    // -----------------------------------------
    // Error logging
    // -----------------------------------------
    console.error(
      "[NetSuite Mark Paid] FAILED",
      {
        operationId,
        orderSyncId: orderSync?.id || null,
        orderName,
        shopifyOrderId,
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        errorStack: error?.stack || null,
        payload,
      }
    );

    // -----------------------------------------
    // Update OrderSync FAILED
    // -----------------------------------------
    if (orderSync) {
      try {
        await prisma.orderSync.update({
          where: {
            id: orderSync.id,
          },
          data: {
            status: STATUS.FAILED,
            action: EVENT_TYPE.PAYMENT_CAPTURE,
            errorMessage: error.message,
          },
        });
      } catch (dbUpdateError) {
        console.error(
          "[NetSuite Mark Paid] Failed to update OrderSync",
          {
            operationId,
            dbError: dbUpdateError.message,
          }
        );
      }

      // -----------------------------------------
      // Create FAILED log
      // -----------------------------------------
      try {
        await prisma.orderSyncLog.create({
          data: {
            orderSyncId: orderSync.id,
            sourceSystem: SYSTEM.NETSUITE,
            direction: DIRECTION.NETSUITE_TO_SHOPIFY,
            eventType: EVENT_TYPE.PAYMENT_CAPTURE,
            status: STATUS.FAILED,
            message: error.message,
            requestPayload: payload || {},
            errorPayload: {
              message: error.message,
              stack: error.stack,
            },
          },
        });
      } catch (dbLogError) {
        console.error(
          "[NetSuite Mark Paid] Failed to create failure log",
          {
            operationId,
            dbError: dbLogError.message,
          }
        );
      }
    }

    return jsonResponse(
      {
        success: false,
        message:
          error?.message ||
          "Failed to mark order as paid",
      },
      500
    );
  }
}