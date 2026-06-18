import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import crypto from "node:crypto";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getOrderTransaction } from "../services/shopify/payment.service";

export async function action({ request }) {
  try {
    const payload = await request.json();
    const { shopifyOrderName, amount, custbody_wmsse_ordertype } = payload;

    console.log(`[Hybrid Capture] Incoming request for Order: ${shopifyOrderName}, Amount: ${amount}`);

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
    console.log(`[Hybrid Capture] SUCCESS! created paymentReferenceId: ${paymentReferenceId}`);

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