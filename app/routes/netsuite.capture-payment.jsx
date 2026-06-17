import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getAuthorizationTransaction } from "../services/shopify/payment.service";

export async function action({ request }) {
  try {
    const payload = await request.json();
    const { shopifyOrderName, amount } = payload;

    console.log(`[Hybrid Capture] Incoming request for Order: ${shopifyOrderName}, Amount: ${amount}`);

    if (!shopifyOrderName || !amount) {
      return json(
        { success: false, message: "shopifyOrderName and amount are required" },
        { status: 400 }
      );
    }

    const orderSync = await prisma.orderSync.findFirst({
      where: { shopifyOrderName },
    });

    if (!orderSync) {
      console.error(`[Hybrid Capture] DB Error: OrderSync record not found for ${shopifyOrderName}`);
      return json({ success: false, message: "OrderSync record not found" }, { status: 404 });
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

    // Get order and auth status from service
    const orderDetails = await getAuthorizationTransaction(admin, shopifyOrderName);

    let captureResponse;
    let usedMethod = "";

    // --- HYBRID SWITCH LOGIC ---
    if (orderDetails.authorization) {
      /**
       * SCENARIO A: Valid & Active Authorization exists (Within 7 days window)
       * Use standard orderCapture mutation.
       */
      console.log(`[Hybrid Capture] Routing to: STANDARD_CAPTURE (` + orderDetails.authorization.id + `)`);
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
              id: orderDetails.orderId,
              parentTransactionId: orderDetails.authorization.id,
              amount: amount.toString(),
              currency: "USD",
              finalCapture: false, // Keeps the authorization open for remaining fulfillments if within window
            },
          },
        }
      );
    } else {
      /**
       * SCENARIO B: Authorization expired, invalid, or missing (> 7 days)
       * Fallback to Vaulted Card using orderCreatePayment mutation.
       */
      console.log(`[Hybrid Capture] Routing to: VAULTED_CARD_CHARGE (orderCreatePayment)`);
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
                amountSet {
                  shopMoney {
                    amount
                  }
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
            id: orderDetails.orderId,
            chargeAmount: {
              amount: amount.toString(),
              currencyCode: "USD",
            },
          },
        }
      );
    }

    // CRITICAL LOG: Print the exact raw response from Shopify to your server console
    console.log(`[Hybrid Capture] RAW SHOPIFY RESPONSE FOR [${usedMethod}]:`, JSON.stringify(captureResponse, null, 2));

    const resultData = captureResponse?.data?.orderCapture || captureResponse?.data?.orderCreatePayment;
    const userErrors = resultData?.userErrors || [];

    // 1. Handle Explicit User Errors from Shopify
    if (userErrors.length > 0) {
      const errorMsg = userErrors.map((e) => e.message).join(", ");
      console.error(`[Hybrid Capture] Shopify returned User Errors during ${usedMethod}: ${errorMsg}`);

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SHOPIFY",
          eventType: "PAYMENT_CAPTURE",
          status: "FAILED",
          message: `Method [${usedMethod}] failed with UserErrors: ${errorMsg}`,
          requestPayload: payload,
          responsePayload: captureResponse.data,
        },
      });

      return json({ success: false, errors: userErrors, methodUsed: usedMethod }, { status: 400 });
    }

    // Extract transaction details uniformly based on the method used
    let transactionDetails = [];
    if (usedMethod === "STANDARD_CAPTURE") {
      transactionDetails = resultData?.transaction ? [resultData.transaction] : [];
    } else if (usedMethod === "VAULTED_CARD_CHARGE") {
      transactionDetails = resultData?.paymentMapping?.map(m => m.transaction) || [];
    }

    // 2. Handle Silent Failure (Empty Transaction Array or Transaction Status !== SUCCESS)
    if (transactionDetails.length === 0 || transactionDetails[0]?.status !== "SUCCESS") {
      const txStatus = transactionDetails[0]?.status || "NO_TRANSACTION_CREATED";
      console.error(`[Hybrid Capture] SILENT FAILURE: Method [${usedMethod}] generated transaction status: ${txStatus}`);

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SHOPIFY",
          eventType: "PAYMENT_CAPTURE",
          status: "FAILED",
          message: `Silent Failure: Mutation [${usedMethod}] executed but transaction status is [${txStatus}].`,
          requestPayload: payload,
          responsePayload: captureResponse.data,
        },
      });

      return json({
        success: false,
        message: `Payment capture failed to settle via ${usedMethod}. Status: ${txStatus}`,
        methodUsed: usedMethod,
        rawShopifyData: captureResponse.data
      }, { status: 400 });
    }

    // 3. Success Path
    const finalTx = transactionDetails[0];
    const updatedFinancialStatus = resultData?.order?.displayFinancialStatus;
    console.log(`[Hybrid Capture] SUCCESS! Method [${usedMethod}] created Transaction ${finalTx.id} with status ${finalTx.status}`);

    // Update OrderSync table: Mark captured date ONLY if the order is completely "PAID"
    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        paymentCapturedAt: updatedFinancialStatus === "PAID" ? new Date() : null,
      },
    });

    // Create success log in Database
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: "NETSUITE",
        direction: "NETSUITE_TO_SHOPIFY",
        eventType: "PAYMENT_CAPTURE",
        status: "SUCCESS",
        message: `Payment of ${amount} captured successfully using [${usedMethod}]. Order Status: ${updatedFinancialStatus}`,
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
    console.error("[Hybrid Capture] CRITICAL EXCEPTION THROWN:", error);
    return json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}