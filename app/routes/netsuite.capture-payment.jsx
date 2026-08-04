import { json } from "../utils/jsonResponse";
import crypto from "node:crypto";
import { getAdminClient } from "../shopify.server";
import { getOrderTransaction, createMandatePayment, toShopifyOrderGid } from "../services/shopify/payment.service";
import { netsuite } from "../services/netsuite/netsuite.server";
import { sleep, getNetSuiteErrorMessage, updateNetSuiteOrderTypeWithRetry,updateNetSuiteOrderChargeDecline } from "../utils/payment.utils";
import { orderRepository } from "../repositories/order.repository";
import { paymentRepository } from "../repositories/payment.repository";
import { syncLogger } from "../repositories/logger.service";

const MAX_JOB_POLL_ATTEMPTS = 6;     
const JOB_POLL_DELAY_MS = 20000;    

export async function action({ request }) {
  let orderSync = null;
  let payload = null;
  
  try {
    try {
      payload = await request.json();
    } catch (jsonErr) {
      console.error("[Payment Capture] Invalid JSON payload received:", jsonErr);
      return json({ success: false, message: "Invalid JSON format in request body" }, { status: 400 });
    }

    const { shopifyOrderName, amount, custbody_wmsse_ordertype, shop } = payload;
    console.log(`[Payment Capture] Incoming request for Order: ${shopifyOrderName}, Amount: ${amount}`);

    const targetShop = shop || process.env.SHOP;
    if (!targetShop) {
      return json({ success: false, message: "Shop domain parameters are missing" }, { status: 400 });
    }
    const admin = await getAdminClient(targetShop);

    if (!shopifyOrderName || !amount) {
      return json({ success: false, message: "shopifyOrderName and amount are required" }, { status: 400 });
    }

    if (custbody_wmsse_ordertype !== "Shopify Ready To Charge") {
      return json({ success: false, message: "Order type does not match criteria for automated charging." }, { status: 400 });
    }

    orderSync = await orderRepository.findByName(shopifyOrderName);
    if (!orderSync) {
      await syncLogger.failed({
        message: `order not found in database with order name: ${shopifyOrderName}`,
        requestPayload: payload,
      }).catch(err => console.error("[Logger Error] Failed to log userErrors:", err));
      return json({ success: false, message: "OrderSync record not found" }, { status: 404 });
    }

    const orderID = toShopifyOrderGid(orderSync.shopifyOrderId);
    const orderDetails = await getOrderTransaction(admin, orderID);
    
    if (!orderDetails?.mandateId) {
       await syncLogger.failed({
        message: `No saved card found for offline charging on this order: ${shopifyOrderName}`,
        requestPayload: payload,
      }).catch(err => console.error("[Logger Error] Failed to log userErrors:", err));
      return json({ success: false, message: "No saved payment mandate found on this order for offline charging." }, { status: 400 });
    }

    const idempotencyKey = crypto.randomBytes(16).toString("hex");

    console.log("payment initiated")
    const captureResponse = await createMandatePayment(admin, {
      orderId: orderID,
      mandateId: orderDetails.mandateId,
      idempotencyKey: idempotencyKey,
      amount: amount
    });

    console.log(`[Payment Capture] RAW SHOPIFY MUTATION RESPONSE`, JSON.stringify(captureResponse, null, 2));

    const resultData = captureResponse?.data?.orderCreateMandatePayment;
    const userErrors = resultData?.userErrors || [];

    if (userErrors.length > 0) {
      await syncLogger.failed({
        orderSyncId: orderSync.id,
        message: `failed with UserErrors: ${userErrors.map(e => e.message).join(", ")}`,
        requestPayload: payload,
        responsePayload: captureResponse?.data
      }).catch(err => console.error("[Logger Error] Failed to log userErrors:", err));

      return json({ success: false, errors: userErrors }, { status: 400 });
    }

    let initialPaymentReferenceId = resultData?.paymentReferenceId;
    let jobResolvedSuccessfully = false;
    let paymentStatusDetails = null;
     const db = await orderRepository.findByName(shopifyOrderName);
      const netsuiteCustomerId = db.netsuiteCompanyId; 
      const netsuiteOrderId = db.netsuiteOrderId; 

    if (initialPaymentReferenceId) {
      console.log(`[Payment Capture] Tracking Payment Reference ID: ${initialPaymentReferenceId}`);
      
      for (let pollAttempt = 1; pollAttempt <= MAX_JOB_POLL_ATTEMPTS; pollAttempt++) {
        console.log(`[Payment Capture] Polling via orderPaymentStatus, attempt ${pollAttempt}/${MAX_JOB_POLL_ATTEMPTS}. Waiting 20s...`);
        await sleep(JOB_POLL_DELAY_MS);

        try {
          const paymentStatusResponse = await admin.request(
            `
            query CheckOrderPaymentStatus($orderId: ID!, $paymentReferenceId: String!) {
              orderPaymentStatus(orderId: $orderId, paymentReferenceId: $paymentReferenceId) {
                status errorMessage paymentReferenceId
              }
            }
            `,
            { variables: { orderId: orderID, paymentReferenceId: initialPaymentReferenceId } }
          );
          
          console.log(`[Payment Capture] raw response paymentStatusResponse: ${JSON.stringify(paymentStatusResponse,null,2)}`);
          paymentStatusDetails = paymentStatusResponse?.data?.orderPaymentStatus;
          const currentStatus = paymentStatusDetails?.status;
          
          console.log(`[Payment Capture] Polled Order Payment Status: ${currentStatus}`);

          if (
            currentStatus === "SUCCESS" || 
            currentStatus === "CAPTURED" || 
            currentStatus === "AUTHORIZED" ||
            currentStatus === "PURCHASED"
          ) {
            jobResolvedSuccessfully = true;
            break;
          }

          if (currentStatus === "ERROR" || currentStatus === "FAILED") {
            console.error(`[Payment Capture] Payment explicitly failed: ${paymentStatusDetails?.errorMessage}`);
          
            setTimeout(async function () {
   await updateNetSuiteOrderChargeDecline(netsuiteOrderId)
}, 3000);
            break; 
          }
        } catch (pollError) {
          console.error(`[Payment Capture] Error executing orderPaymentStatus query on attempt ${pollAttempt}:`, pollError);
          
          if (orderSync?.id) {
            await syncLogger.failed({
              orderSyncId: orderSync.id,
              message: `Polling attempt ${pollAttempt}/${MAX_JOB_POLL_ATTEMPTS} failed with network/API error: ${pollError.message}`,
              requestPayload: payload,
              responsePayload: { error: pollError?.toString() }
            }).catch(err => console.error("[Logger Error] Failed to log polling exception:", err));
          }
        }
      }
    }

    if (!jobResolvedSuccessfully) {
      const failedReason = paymentStatusDetails?.errorMessage || "Payment processing job failed to finish, timed out, or was declined.";
      
      await syncLogger.failed({
        orderSyncId: orderSync.id,
        message: `Payment background check failed to confirm success. State details: ${failedReason}`,
        requestPayload: payload,
        responsePayload: { paymentStatus: paymentStatusDetails || {} }
      }).catch(err => console.error("[Logger Error] Failed to log job unresolution:", err));

      return json({
        success: false,
        message: `Payment was declined or timed out. Details: ${failedReason}`,
        paymentStatusDetails
      }, { status: 402 });
    }

    const finalPaymentReferenceId = paymentStatusDetails?.paymentReferenceId || initialPaymentReferenceId;
    console.log(`[PAYMENT Capture] SUCCESS confirmed. Proceeding to Customer Deposit creation with reference: ${finalPaymentReferenceId}`);

    // ---  NETSUITE CUSTOMER DEPOSIT BLOCK START ---
    try {
     

      if (typeof netsuite !== "undefined" && netsuiteCustomerId && netsuiteOrderId) {
        const depositPayload = {
          customer: { id: netsuiteCustomerId.toString() },
          salesOrder: { id: netsuiteOrderId.toString() },
          payment: Number(amount),
          memo: `Automated Deposit via Shopify Capture. Ref: ${finalPaymentReferenceId}`,
          custbody_ch_web_payment_token_ref:`${finalPaymentReferenceId}`,
          cseg1:{id:'3'}, // busness unit set to furniture as in erly discussion it confirm it will be always furniture
          paymentoption:{ id:"224151"} // id of option shopify payment in netsuite customer deposite record paymetn options 
        };

        const depositResult = await netsuite.createCustomerDeposit(depositPayload);

        if (depositResult.success) {
          console.log(`[NetSuite Deposit] ✅ Deposit created successfully.`);
          const orderUpdateResult = await updateNetSuiteOrderTypeWithRetry(netsuiteOrderId);

          if (!orderUpdateResult.success) {
            await syncLogger.failed({
              orderSyncId: orderSync.id,
              eventType: "ORDER_STATUS_UPDATE",
              direction: "NETSUITE_TO_NETSUITE",
              message: getNetSuiteErrorMessage(orderUpdateResult),
              requestPayload: { netsuiteOrderId },
              responsePayload: orderUpdateResult.data || {}
            }).catch(err => console.error("[Logger Error] Failed to log NetSuite order update failure:", err));
          } else {
            await syncLogger.success({
              orderSyncId: orderSync.id,
              eventType: "ORDER_STATUS_UPDATE",
              direction: "NETSUITE_TO_NETSUITE",
              message: "NetSuite sales order set to Ready to wave",
              requestPayload: { netsuiteOrderId },
              responsePayload: orderUpdateResult
            }).catch(err => console.error("[Logger Error] Failed to log NetSuite order update success:", err));
          }
        } else {
          console.error(`[NetSuite Deposit] ❌ NetSuite API Rejected Deposit:`, JSON.stringify(depositResult.data, null, 2));
          
          await syncLogger.failed({
            orderSyncId: orderSync.id,
            eventType: "CUSTOMER_DEPOSIT",
            direction: "SHOPIFY_TO_NETSUITE",
            message: `NetSuite rejected customer deposit creation.`,
            requestPayload: depositPayload,
            responsePayload: depositResult.data || {}
          }).catch(err => console.error("[Logger Error] Failed to log NetSuite deposit rejection:", err));
        }
      } else if (typeof netsuite === "undefined") {
        console.error("[NetSuite Deposit] ❌ 'netsuite' object is undefined. Check your server file import.");
      }
    } catch (nsError) {
      console.error(`[NetSuite Deposit] Critical error during deposit creation:`, nsError);
      
      if (orderSync?.id) {
        await syncLogger.failed({
          orderSyncId: orderSync.id,
          eventType: "CUSTOMER_DEPOSIT",
          direction: "SHOPIFY_TO_NETSUITE",
          message: `Critical exception in NetSuite integration block: ${nsError.message}`,
          requestPayload: { shopifyOrderName },
          responsePayload: { error: nsError?.toString() }
        }).catch(err => console.error("[Logger Error] Failed to log NetSuite block exception:", err));
      }
    }
    // ---  NETSUITE CUSTOMER DEPOSIT BLOCK END ---

    await orderRepository.updatePaymentCaptureTime(orderSync.id);

    await syncLogger.success({
      orderSyncId: orderSync.id,
      message: `Payment of ${amount} successfully settled. Ref: ${finalPaymentReferenceId}`,
      requestPayload: payload,
      responsePayload: captureResponse?.data || {}
    }).catch(err => console.error("[Logger Error] Failed to log final success:", err));

    await paymentRepository.createPaymentSync({
      netsuiteOrderId: orderSync.netsuiteOrderId,
      shopifyOrderId: orderSync.shopifyOrderId,
      authorizationId: shopifyOrderName,
      paymentReference: finalPaymentReferenceId,
      capturedAmount: Number(amount), 
      status: "SUCCESS"
    });

    return json({
      success: true,
      paymentReferenceId: finalPaymentReferenceId,
      status: "SUCCESS"
    });

  } catch (error) {
    console.error("[Hybrid Capture] CRITICAL EXCEPTION THROWN:", error);
    
    if (orderSync?.id) {
      await syncLogger.failed({
        orderSyncId: orderSync.id,
        message: `Critical system failure: ${error.message}`,
        requestPayload: payload || {},
        responsePayload: { exception: error?.toString() }
      }).catch(err => console.error("[Emergency Logger Error] Failed to create emergency failure log:", err));
    } else {
      console.error("[Emergency Log Backup] Could not log to DB because orderSync was null. Payload Backup:", JSON.stringify(payload));
    }

    return json({ success: false, message: error.message }, { status: 500 });
  }
}
