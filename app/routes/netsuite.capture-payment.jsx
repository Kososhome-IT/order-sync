import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getAuthorizationTransaction } from "../services/shopify/payment.service";


export async function action({ request }) {
  try {
    const payload = await request.json();

    const {
      shopifyOrderName,
      amount,
    } = payload;

    const apiKey = request.headers.get("x-api-key");

// if (
//   apiKey !== process.env.INTERNAL_API_KEY
// ) {
//   return json(
//     {
//       success: false,
//       message: "Unauthorized",
//     },
//     { status: 401 }
//   );
// }

    if (!shopifyOrderName) {
      return json(
        {
          success: false,
          message: "shopifyOrderName is required",
        },
        { status: 400 }
      );
    }

    if (!amount) {
      return json(
        {
          success: false,
          message: "amount is required",
        },
        { status: 400 }
      );
    }

const orderSync =
  await prisma.orderSync.findFirst({
    where: {
      shopifyOrderName,
    },
  });
    if (!orderSync) {
      return json(
        {
          success: false,
          message: "OrderSync record not found",
        },
        { status: 404 }
      );
    }

    // if (orderSync.paymentCapturedAt) {
    //   return json({
    //     success: true,
    //     message:
    //       "Payment already captured",
    //   });
    // }

    const shopDomain = process.env.SHOP;

    const session =
      await sessionStorage.loadSession(
        `offline_${shopDomain}`
      );

    if (!session) {
      throw new Error(
        "Offline session not found"
      );
    }

    const admin =
      createAdminApiClient({
        storeDomain: shopDomain,
        apiVersion: "2025-07",
        accessToken:
          session.accessToken,
      });

   const orderAuthorization = await getAuthorizationTransaction(admin,shopifyOrderName);

    if (!orderAuthorization?.authorization) {
      throw new Error(
        "Authorization transaction not found"
      );
    }

    const captureResponse =
      await admin.request(
        `
        mutation CaptureOrder(
          $input: OrderCaptureInput!
        ) {
          orderCapture(
            input: $input
          ) {
            transaction {
              id
              kind
              status

              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            input: {
              id: orderAuthorization.orderId,
              parentTransactionId:
                orderAuthorization.authorization.id,
              amount:
                amount.toString(),
              currency: "USD",
              finalCapture: true,
            },
          },
        }
      );

  const captureResult =
  captureResponse?.data?.orderCapture;

    if (
      captureResult?.userErrors
        ?.length > 0
    ) {
      await prisma.orderSyncLog.create({
        data: {
          orderSyncId:
            orderSync.id,
          sourceSystem:
            "NETSUITE",
          direction:
            "NETSUITE_TO_SHOPIFY",
          eventType:
            "PAYMENT_CAPTURE",
          status: "FAILED",
          message:
            captureResult.userErrors
              .map(
                (e) =>
                  e.message
              )
              .join(", "),
          requestPayload:
            payload,
          responsePayload:
            captureResponse.data,
        },
      });

      return json(
        {
          success: false,
          errors:
            captureResult.userErrors,
        },
        { status: 400 }
      );
    }

    await prisma.orderSync.update({
      where: {
        id: orderSync.id,
      },
      data: {
        paymentCapturedAt:
          new Date(),
      },
    });

    await prisma.orderSyncLog.create({
      data: {
        orderSyncId:
          orderSync.id,
        sourceSystem:
          "NETSUITE",
        direction:
          "NETSUITE_TO_SHOPIFY",
        eventType:
          "PAYMENT_CAPTURE",
        status: "SUCCESS",
        message:
          "Payment captured successfully",
        requestPayload:
          payload,
        responsePayload:
          captureResponse.data,
      },
    });

    return json({
      success: true,
      transaction:
        captureResult.transaction,
    });
  } catch (error) {
    console.error(
      "Capture payment error:",
      error
    );

    return json(
      {
        success: false,
        message:
          error.message,
      },
      { status: 500 }
    );
  }
}  