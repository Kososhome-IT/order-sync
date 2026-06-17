import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getOrderAuthorizationDetails } from "../services/shopify/payment.service";

export async function action({ request }) {
  try {
    const payload = await request.json();
    const { shopifyOrderName, amount } = payload;

    // Input Validation
    if (!shopifyOrderName || !amount) {
      return json(
        { success: false, message: "shopifyOrderName and amount are required" },
        { status: 400 }
      );
    }

    // Find the order sync record in DB
    const orderSync = await prisma.orderSync.findFirst({
      where: { shopifyOrderName },
    });

    if (!orderSync) {
      return json(
        { success: false, message: "OrderSync record not found" },
        { status: 404 }
      );
    }

    const shopDomain = process.env.SHOP;
    const session = await sessionStorage.loadSession(`offline_${shopDomain}`);

    if (!session) {
      throw new Error("Offline session not found");
    }

    const admin = createAdminApiClient({
      storeDomain: shopDomain,
      apiVersion: "2025-07",
      accessToken: session.accessToken,
    });

    // Fetch order status and check for existing authorization
    const orderDetails = await getOrderAuthorizationDetails(admin, shopifyOrderName);

    let captureResponse;
    let usedMethod = "";

    // --- HYBRID LOGIC for payment capture START ---
    if (orderDetails.authorization) {
      /** for Active Authorization exists (Within 7-30 days window)
        standard orderCapture mutation.
       */
      console.log(`[Payment Sync] Active authorization found for ${shopifyOrderName}. Using orderCapture...`);
      usedMethod = "STANDARD_CAPTURE";

      captureResponse = await admin.request(
        `
        mutation CaptureOrder($input: OrderCaptureInput!) {
          orderCapture(input: $input) {
            order {
              id
              displayFinancialStatus
            }
            transaction {
              id
              kind
              status
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
              id: orderDetails.orderId,
              parentTransactionId: orderDetails.authorization.id,
              amount: amount.toString(),
              currency: "USD",
              finalCapture: false, // Set to false since multiple fulfillments might happen
            },
          },
        }
      );
    } else {
      /**
       * Authorization expired or does not exist (30+ days later)
        Vaulted Card using orderCreatePayment mutation.
       */
      console.log(`[Payment Sync] No active authorization for ${shopifyOrderName}. Falling back to Vaulted Card via orderCreatePayment...`);
      usedMethod = "VAULTED_CARD_CHARGE";

      captureResponse = await admin.request(
        `
        mutation OrderCreatePayment($id: ID!, $chargeAmount: MoneyInput!) {
          orderCreatePayment(id: $id, chargeAmount: $chargeAmount) {
            order {
              id
              displayFinancialStatus
            }
            paymentMapping {
              transaction {
                id
                kind
                status
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
            id: orderDetails.orderId,
            chargeAmount: {
              amount: amount.toString(),
              currencyCode: "USD",
            },
          },
        }
      );
    }
    // --- HYBRID LOGIC END ---

    // Extract correct result based on mutation used
    const resultData = captureResponse?.data?.orderCapture || captureResponse?.data?.orderCreatePayment;
    const userErrors = resultData?.userErrors || [];

    // Handle Errors from Shopify (e.g., Card declined, Authorization expired on gateway level)
    if (userErrors.length > 0) {
      const errorMessage = userErrors.map((e) => e.message).join(", ");

      // Log failure in DB
      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SHOPIFY",
          eventType: "PAYMENT_CAPTURE",
          status: "FAILED",
          message: `Method [${usedMethod}] failed: ${errorMessage}`,
          requestPayload: payload,
          responsePayload: captureResponse.data,
        },
      });

      return json({ success: false, errors: userErrors, methodUsed: usedMethod }, { status: 400 });
    }

    const updatedFinancialStatus = resultData?.order?.displayFinancialStatus;
    const transactionDetails = resultData?.transaction || resultData?.paymentMapping?.map(m => m.transaction) || [];

    // Update OrderSync table: Set paymentCapturedAt only when the entire order is fully "PAID"
    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        paymentCapturedAt: updatedFinancialStatus === "PAID" ? new Date() : null,
      },
    });

    // Log Success in DB
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: "NETSUITE",
        direction: "NETSUITE_TO_SHOPIFY",
        eventType: "PAYMENT_CAPTURE",
        status: "SUCCESS",
        message: `Successfully charged ${amount} using ${usedMethod}. Current financial status: ${updatedFinancialStatus}`,
        requestPayload: payload,
        responsePayload: captureResponse.data,
      },
    });

    return json({
      success: true,
      methodUsed: usedMethod,
      financialStatus: updatedFinancialStatus,
      transactions: transactionDetails,
    });

  } catch (error) {
    console.error("Capture payment error:", error);
    return json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}