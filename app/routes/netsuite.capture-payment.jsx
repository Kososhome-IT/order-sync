import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import crypto from "node:crypto";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getOrderTransaction } from "../services/shopify/payment.service";
import { netsuite } from "../services/netsuite/netsuite.server";

const NETSUITE_READY_TO_WAVE_ORDER_TYPE_ID = "2";
const NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS = [0, 2000, 5000, 10000];
const NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD = "custbody_ch_deposit_amount_charge_shop";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNetSuiteErrorMessage(result) {
  return (
    result?.data?.["o:errorDetails"]
      ?.map((error) => error.detail)
      ?.join(", ") ||
    result?.data?.message ||
    "NetSuite sales order status update failed"
  );
}

function isRecordChangedError(result) {
  return getNetSuiteErrorMessage(result).includes("Record has been changed");
}

async function updateNetSuiteOrderTypeWithRetry(netsuiteOrderId) {
  let lastResult = null;

  for (let attempt = 0; attempt < NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS[attempt];

    if (delayMs > 0) {
      console.log(
        `[NetSuite Update Order] Waiting ${delayMs}ms before retry ${attempt + 1} for Sales Order ${netsuiteOrderId}`
      );
      await sleep(delayMs);
    }

    lastResult = await netsuite.updateOrderFields(netsuiteOrderId, {
      custbody_wmsse_ordertype: {
        id: NETSUITE_READY_TO_WAVE_ORDER_TYPE_ID,
      },
      [NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD]: null,
    });

    if (lastResult.success || !isRecordChangedError(lastResult)) {
      return {
        ...lastResult,
        attempts: attempt + 1,
      };
    }

    console.warn(
      `[NetSuite Update Order] NetSuite says record changed for Sales Order ${netsuiteOrderId}; retrying.`
    );
  }

  return {
    ...lastResult,
    attempts: NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS.length,
  };
}

export async function action({ request }) {
  try {
    const payload = await request.json();
    const { shopifyOrderName, amount, custbody_wmsse_ordertype } = payload;

    console.log(`[Payment Capture] Incoming request for Order: ${shopifyOrderName}, Amount: ${amount}`);

    if (!shopifyOrderName || !amount) {
      return json(
        { success: false, message: "shopifyOrderName and amount are required" },
        { status: 400 }
      );
    }

    // FIX 1: Early Return if order type doesn't match to prevent undefined execution/crashes
    if (custbody_wmsse_ordertype !== "Shopify Ready To Charge") {
      console.warn(`[Payment Capture] Ignored: Order type is [${custbody_wmsse_ordertype}].`);
      return json(
        { success: false, message: "Order type does not match criteria for automated charging." }, 
        { status: 400 }
      );
    }

    const orderSync = await prisma.orderSync.findFirst({
      where: { shopifyOrderName },
    });

    if (!orderSync) {
      console.error(`[Payment Capture] DB Error: OrderSync record not found for ${shopifyOrderName}`);
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

    const orderID = `gid://shopify/Order/${orderSync.shopifyOrderId}`;
    
    // Get order and mandate details from service
    const orderDetails = await getOrderTransaction(admin, orderID);

    if (!orderDetails?.mandateId) {
      console.error(`[Hybrid Capture] Error: No Vaulted Payment Mandate found for B2B Order.`);
      return json(
        { success: false, message: "No saved payment mandate found on this order for offline charging." }, 
        { status: 400 }
      );
    }

    console.log(`[Payment Capture Started]`);
    const idempotencyKey = crypto.randomBytes(16).toString("hex");

    const captureResponse = await admin.request(
      `
      mutation OrderCreateMandatePayment($amount: MoneyInput!, $autoCapture: Boolean!, $id: ID!, $idempotencyKey: String!, $mandateId: ID!) {
        orderCreateMandatePayment(amount: $amount, autoCapture: $autoCapture, id: $id, idempotencyKey: $idempotencyKey, mandateId: $mandateId) {
          job {
            id
            done
          }
          paymentReferenceId
          userErrors {
            field
            message
          }
        }
      }
      `,
      {
        variables: {
          id: orderID,
          mandateId: orderDetails.mandateId,
          idempotencyKey: idempotencyKey,
          autoCapture: true,
          amount: {
            amount: amount.toString(),
            currencyCode: "USD"
          }
        },
      }
    );

    // Safe logging since captureResponse is guaranteed to exist here
    console.log(`[Payment Capture] RAW SHOPIFY RESPONSE`, JSON.stringify(captureResponse, null, 2));

    const resultData = captureResponse?.data?.orderCreateMandatePayment;
    const userErrors = resultData?.userErrors || [];

    // 1. Handle Explicit User Errors from Shopify
    if (userErrors.length > 0) {
      const errorMsg = userErrors.map((e) => e.message).join(", ");
      console.error(`[Payment Capture] Shopify returned User Errors: ${errorMsg}`);

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SHOPIFY",
          eventType: "PAYMENT_CAPTURE",
          status: "FAILED",
          message: `failed with UserErrors: ${errorMsg}`,
          requestPayload: payload,
          responsePayload: captureResponse?.data || {},
        },
      });

      return json({ success: false, errors: userErrors }, { status: 400 });
    }

    let paymentReferenceId = resultData?.paymentReferenceId;
    const jobInfo = resultData?.job;

    // 2. FIX 2: Handle Asynchronous Background Job if paymentReferenceId is not immediately available
    if (!paymentReferenceId && jobInfo) {
      console.log(`[Payment Capture] Payment is processing asynchronously. Job ID: ${jobInfo.id}`);

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SYNCHRONIZER",
          eventType: "PAYMENT_CAPTURE",
          status: "PROCESSING",
          message: `Payment charge job submitted to Shopify background queue. Job ID: ${jobInfo.id}`,
          requestPayload: payload,
          responsePayload: captureResponse?.data || {},
        },
      });

      return json({
        success: true,
        message: "Payment capture is being processed by Shopify in the background.",
        job: jobInfo
      });
    }

    // 3. Handle True Silent Failure (No payment reference ID AND no background job generated)
    if (!paymentReferenceId) {
      console.error(`[Payment Capture] SILENT FAILURE: No payment reference or job data returned.`);

      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "NETSUITE",
          direction: "NETSUITE_TO_SHOPIFY",
          eventType: "PAYMENT_CAPTURE",
          status: "FAILED",
          message: `Silent Failure: No payment reference id or job received from Shopify.`,
          requestPayload: payload,
          responsePayload: captureResponse?.data || {},
        },
      });

      return json({
        success: false,
        message: `Payment capture failed to settle. Status: Failed`,
        rawShopifyData: captureResponse?.data || {}
      }, { status: 400 });
    }

    // 4. Success Path (Synchronous Settlement)
    console.log(`[PAYMENT Capture] SUCCESS! created paymentReferenceId: ${paymentReferenceId}`);

    console.log(`[PAYMENT Capture] SUCCESS! created paymentReferenceId: ${paymentReferenceId}`);

    // // ---  NETSUITE CUSTOMER DEPOSIT BLOCK start ---
    try {
      const db =  await prisma.orderSync.findFirst({
      where: { shopifyOrderName },
    });
      //
      const netsuiteCustomerId = db.netsuiteCompanyId; 
      const netsuiteOrderId = db.netsuiteOrderId; 

      console.log(`[NetSuite Deposit] Checking IDs in DB -> CustomerId: ${netsuiteCustomerId}, OrderId: ${netsuiteOrderId}`);

      // 2. runtime check for null/undefined 
      if (netsuiteCustomerId && netsuiteOrderId) {
        const depositPayload = {
          customer: { id: netsuiteCustomerId.toString() },
          salesOrder: { id: netsuiteOrderId.toString() },
          payment: Number(amount),
          memo: `Automated Deposit via Shopify Capture. Ref: ${paymentReferenceId}`
        };

        console.log(`[NetSuite Deposit] Sending payload to NetSuite...`);
        const depositResult = await netsuite.createCustomerDeposit(depositPayload);

       

        if (depositResult.success) {
          console.log(`[NetSuite Deposit] ✅ Deposit created successfully. Location: ${depositResult.location}`);
          // setting order type status to ready to wave
          console.log(`[NetSuite Update Order] ✅ Deposit created successfully. Now setting order status to Ready to wave`);
          const orderUpdateResult = await updateNetSuiteOrderTypeWithRetry(netsuiteOrderId);

          if (!orderUpdateResult.success) {
            const message = getNetSuiteErrorMessage(orderUpdateResult);

            console.error(
              `[NetSuite Update Order] Failed to update order type for Sales Order ${netsuiteOrderId}: ${message}`,
              JSON.stringify(orderUpdateResult.data, null, 2)
            );

            await prisma.orderSyncLog.create({
              data: {
                orderSyncId: orderSync.id,
                sourceSystem: "NETSUITE",
                direction: "NETSUITE_TO_NETSUITE",
                eventType: "ORDER_STATUS_UPDATE",
                status: "FAILED",
                message,
                requestPayload: {
                  netsuiteOrderId,
                  custbody_wmsse_ordertype: NETSUITE_READY_TO_WAVE_ORDER_TYPE_ID,
                  [NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD]: null,
                  attempts: orderUpdateResult.attempts,
                },
                responsePayload: orderUpdateResult.data || {},
              },
            });
          } else {
            console.log(
              `[NetSuite Update Order] Sales Order ${netsuiteOrderId} set to Ready to wave after ${orderUpdateResult.attempts} attempt(s).`
            );

            await prisma.orderSyncLog.create({
              data: {
                orderSyncId: orderSync.id,
                sourceSystem: "NETSUITE",
                direction: "NETSUITE_TO_NETSUITE",
                eventType: "ORDER_STATUS_UPDATE",
                status: "SUCCESS",
                message: "NetSuite sales order set to Ready to wave",
                requestPayload: {
                  netsuiteOrderId,
                  custbody_wmsse_ordertype: NETSUITE_READY_TO_WAVE_ORDER_TYPE_ID,
                  [NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD]: null,
                  attempts: orderUpdateResult.attempts,
                },
                responsePayload: orderUpdateResult,
              },
            });
          }
        } else {
          console.error(`[NetSuite Deposit] ❌ NetSuite API Rejected Deposit:`, JSON.stringify(depositResult.data, null, 2));
        console.log(`[NetSuite Update Order] skkiped due to no customer deposite created`)
        }
      } else {
        // 3. warn log if no id in db
        console.warn(`[NetSuite Deposit] ⚠️ Skipped: DB is missing netsuiteCompanyId or netsuiteOrderId for this order.`);
      }
    } catch (nsError) {
      console.error(`[NetSuite Deposit] Critical error during deposit creation:`, nsError);
    }

    // // ---  NETSUITE CUSTOMER DEPOSIT BLOCK END ---

    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        paymentCapturedAt: new Date(),
      },
    });

    await prisma.orderSyncLog.create({
      data: {
        orderSyncId: orderSync.id,
        sourceSystem: "NETSUITE",
        direction: "NETSUITE_TO_SHOPIFY",
        eventType: "PAYMENT_CAPTURE",
        status: "SUCCESS",
        message: `Payment of ${amount} captured successfully. payment Reference Id: ${paymentReferenceId}`,
        requestPayload: payload,
        responsePayload: captureResponse?.data || {},
      },
    });

 await prisma.paymentSync.create({
      data: {
        netsuiteOrderId: orderSync.netsuiteOrderId.toString(),
        shopifyOrderId: orderSync.shopifyOrderId.toString(),
        authorizationId:shopifyOrderName,
        paymentReference: paymentReferenceId,
        capturedAmount: amount,
        status: "SUCCESS",
      },
    });

    return json({
      success: true,
      paymentReferenceId: paymentReferenceId,
      Status:"Ready for waiving"
    });

  } catch (error) {
    console.error("[Hybrid Capture] CRITICAL EXCEPTION THROWN:", error);
    return json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
