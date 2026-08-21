import { json } from "../utils/jsonResponse";
import crypto from "node:crypto";
import { getAdminClient } from "../shopify.server";
import {
  getOrderTransaction,
  createMandatePayment,
  toShopifyOrderGid,
} from "../services/shopify/payment.service";
import { netsuite } from "../services/netsuite/netsuite.server";
import {
  sleep,
  getNetSuiteErrorMessage,
  updateNetSuiteOrderTypeWithRetry,
  updateNetSuiteOrderChargeDecline,
} from "../utils/payment.utils";
import { orderRepository } from "../repositories/order.repository";
import { paymentRepository } from "../repositories/payment.repository";
import { syncLogger } from "../repositories/logger.service";
import {
  NETSUITE_CONFIG,
  PAYMENT_CONFIG,
  SHOPIFY_CONFIG,
} from "../constants/integrationConfig";

const { customerDeposit: NETSUITE_CUSTOMER_DEPOSIT } = NETSUITE_CONFIG;

export async function action({ request }) {
  let orderSync = null;
  let payload = null;

  try {
    console.log("[Payment Capture] ========================================");
    console.log("[Payment Capture] REQUEST STARTED");

    try {
      payload = await request.json();
    } catch (jsonErr) {
      console.error(
        "[Payment Capture] ❌ Invalid JSON payload received:",
        jsonErr
      );

      return json(
        {
          success: false,
          message: "Invalid JSON format in request body",
        },
        { status: 400 }
      );
    }

    const {
      shopifyOrderName,
      amount,
      netsuiteSalesOrderId,
      custbody_wmsse_ordertype,
      shop,
    } = payload;

    console.log(
      `[Payment Capture] Incoming request | Order: ${shopifyOrderName} | Amount: ${amount} | NetSuite SO: ${netsuiteSalesOrderId}`
    );

    const targetShop = shop || process.env.SHOP;

    if (!targetShop) {
      console.error(
        "[Payment Capture] ❌ Shop domain parameter is missing."
      );

      return json(
        {
          success: false,
          message: "Shop domain parameters are missing",
        },
        { status: 400 }
      );
    }

    console.log(`[Payment Capture] Shopify shop: ${targetShop}`);

    const admin = await getAdminClient(targetShop);

    console.log("[Payment Capture] Shopify Admin client initialized.");

    if (!shopifyOrderName || !amount) {
      console.error(
        `[Payment Capture] ❌ Missing required parameters | shopifyOrderName: ${shopifyOrderName} | amount: ${amount}`
      );

      return json(
        {
          success: false,
          message: "shopifyOrderName and amount are required",
        },
        { status: 400 }
      );
    }

    console.log(
      `[Payment Capture] Required parameters validated for ${shopifyOrderName}.`
    );

    if (
      custbody_wmsse_ordertype !==
      SHOPIFY_CONFIG.order.readyToChargeTypeName
    ) {
      console.warn(
        `[Payment Capture] ⚠️ Order type does not match charging criteria | Order: ${shopifyOrderName} | Received: ${custbody_wmsse_ordertype} | Expected: ${SHOPIFY_CONFIG.order.readyToChargeTypeName}`
      );

      return json(
        {
          success: false,
          message: "Order type does not match criteria for automated charging.",
        },
        { status: 400 }
      );
    }

    console.log(
      `[Payment Capture] Order type validated for ${shopifyOrderName}.`
    );

    console.log(
      `[Payment Capture] Looking up OrderSync record for ${shopifyOrderName}...`
    );

    orderSync = await orderRepository.findByName(shopifyOrderName);

    if (!orderSync) {
      console.error(
        `[Payment Capture] ❌ OrderSync record not found | Order: ${shopifyOrderName}`
      );

      await syncLogger
        .failed({
          message: `order not found in database with order name: ${shopifyOrderName}`,
          requestPayload: payload,
        })
        .catch((err) =>
          console.error(
            "[Logger Error] Failed to log userErrors:",
            err
          )
        );

      return json(
        {
          success: false,
          message: "OrderSync record not found",
        },
        { status: 404 }
      );
    }

    console.log(
      `[Payment Capture] OrderSync found | DB ID: ${orderSync.id} | Shopify Order ID: ${orderSync.shopifyOrderId} | NetSuite Order ID: ${orderSync.netsuiteOrderId}`
    );

    const orderID = toShopifyOrderGid(orderSync.shopifyOrderId);

    console.log(
      `[Payment Capture] Shopify Order GID generated: ${orderID}`
    );

    console.log(
      `[Payment Capture] Retrieving Shopify payment transaction/mandate information for ${shopifyOrderName}...`
    );

    const orderDetails = await getOrderTransaction(admin, orderID);

    console.log(
      `[Payment Capture] Shopify transaction lookup completed | Mandate found: ${Boolean(
        orderDetails?.mandateId
      )}`
    );

    if (!orderDetails?.mandateId) {
      console.error(
        `[Payment Capture] ❌ No saved payment mandate found | Order: ${shopifyOrderName}`
      );

      await syncLogger
        .failed({
          message: `No saved card found for offline charging on this order: ${shopifyOrderName}`,
          requestPayload: payload,
        })
        .catch((err) =>
          console.error(
            "[Logger Error] Failed to log userErrors:",
            err
          )
        );

      return json(
        {
          success: false,
          message:
            "No saved payment mandate found on this order for offline charging.",
        },
        { status: 400 }
      );
    }

    console.log(
      `[Payment Capture] ✅ Payment mandate found for ${shopifyOrderName}.`
    );

    const idempotencyKey = crypto.randomBytes(16).toString("hex");

    console.log(
      `[Payment Capture] Starting Shopify mandate payment | Order: ${shopifyOrderName} | Amount: ${amount} | Idempotency Key: ${idempotencyKey}`
    );

    const captureResponse = await createMandatePayment(admin, {
      orderId: orderID,
      mandateId: orderDetails.mandateId,
      idempotencyKey: idempotencyKey,
      amount: amount,
    });

    console.log(
      `[Payment Capture] Shopify mandate payment request completed | Order: ${shopifyOrderName}`
    );

    const resultData = captureResponse?.data?.orderCreateMandatePayment;
    const userErrors = resultData?.userErrors || [];

    console.log(
      `[Payment Capture] Shopify payment response processed | User errors: ${userErrors.length}`
    );

    if (userErrors.length > 0) {
      console.error(
        `[Payment Capture] ❌ Shopify payment returned userErrors | Order: ${shopifyOrderName} | Errors: ${userErrors
          .map((e) => e.message)
          .join(", ")}`
      );

      await syncLogger
        .failed({
          orderSyncId: orderSync.id,
          message: `failed with UserErrors: ${userErrors
            .map((e) => e.message)
            .join(", ")}`,
          requestPayload: payload,
          responsePayload: captureResponse?.data,
        })
        .catch((err) =>
          console.error(
            "[Logger Error] Failed to log userErrors:",
            err
          )
        );

      return json(
        {
          success: false,
          errors: userErrors,
        },
        { status: 400 }
      );
    }

    let initialPaymentReferenceId = resultData?.paymentReferenceId;
    let jobResolvedSuccessfully = false;
    let paymentStatusDetails = null;

    console.log(
      `[Payment Capture] Payment reference received: ${
        initialPaymentReferenceId || "NONE"
      }`
    );

    const db = await orderRepository.findByName(shopifyOrderName);

    const netsuiteCustomerId = db.netsuiteCompanyId;
    const netsuiteOrderId = netsuiteSalesOrderId;

    console.log(
      `[Payment Capture] NetSuite mapping loaded | Customer ID: ${netsuiteCustomerId} | Sales Order ID: ${netsuiteOrderId}`
    );

    if (initialPaymentReferenceId) {
      console.log(
        `[Payment Capture] 🔄 Starting payment status polling | Reference: ${initialPaymentReferenceId} | Max attempts: ${PAYMENT_CONFIG.jobPolling.maxAttempts} | Delay: ${PAYMENT_CONFIG.jobPolling.delayMs}ms`
      );

      for (
        let pollAttempt = 1;
        pollAttempt <= PAYMENT_CONFIG.jobPolling.maxAttempts;
        pollAttempt++
      ) {
        console.log(
          `[Payment Capture] Poll attempt ${pollAttempt}/${PAYMENT_CONFIG.jobPolling.maxAttempts} | Waiting ${PAYMENT_CONFIG.jobPolling.delayMs}ms...`
        );

        await sleep(PAYMENT_CONFIG.jobPolling.delayMs);

        try {
          const paymentStatusResponse = await admin.request(
            `
            query CheckOrderPaymentStatus($orderId: ID!, $paymentReferenceId: String!) {
              orderPaymentStatus(orderId: $orderId, paymentReferenceId: $paymentReferenceId) {
                status errorMessage paymentReferenceId
              }
            }
            `,
            {
              variables: {
                orderId: orderID,
                paymentReferenceId: initialPaymentReferenceId,
              },
            }
          );

          paymentStatusDetails =
            paymentStatusResponse?.data?.orderPaymentStatus;

          const currentStatus = paymentStatusDetails?.status;

          console.log(
            `[Payment Capture] Poll attempt ${pollAttempt}/${PAYMENT_CONFIG.jobPolling.maxAttempts} completed | Status: ${
              currentStatus || "UNKNOWN"
            } | Error: ${
              paymentStatusDetails?.errorMessage || "None"
            }`
          );

          if (
            currentStatus === "SUCCESS" ||
            currentStatus === "CAPTURED" ||
            currentStatus === "AUTHORIZED" ||
            currentStatus === "PURCHASED"
          ) {
            console.log(
              `[Payment Capture] ✅ Payment successfully resolved | Status: ${currentStatus} | Attempt: ${pollAttempt}`
            );

            jobResolvedSuccessfully = true;
            break;
          }

          if (
            currentStatus === "ERROR" ||
            currentStatus === "FAILED"
          ) {
            console.error(
              `[Payment Capture] ❌ Payment explicitly failed | Status: ${currentStatus} | Error: ${
                paymentStatusDetails?.errorMessage || "Unknown"
              }`
            );

            console.warn(
              `[Payment Capture] Scheduling NetSuite charge decline update in 3 seconds | Sales Order: ${netsuiteOrderId}`
            );

            setTimeout(async function () {
              console.log(
                `[Payment Capture] Executing delayed NetSuite charge decline update | Sales Order: ${netsuiteOrderId}`
              );

              try {
                await updateNetSuiteOrderChargeDecline(
                  netsuiteOrderId
                );

                console.log(
                  `[Payment Capture] ✅ NetSuite charge decline update completed | Sales Order: ${netsuiteOrderId}`
                );
              } catch (declineError) {
                console.error(
                  `[Payment Capture] ❌ NetSuite charge decline update failed | Sales Order: ${netsuiteOrderId}:`,
                  declineError
                );
              }
            }, 3000);

            break;
          }

          console.log(
            `[Payment Capture] Payment still processing | Status: ${
              currentStatus || "UNKNOWN"
            } | Continuing polling...`
          );
        } catch (pollError) {
          console.error(
            `[Payment Capture] ❌ Error executing orderPaymentStatus query | Attempt: ${pollAttempt}/${PAYMENT_CONFIG.jobPolling.maxAttempts}:`,
            pollError
          );

          if (orderSync?.id) {
            await syncLogger
              .failed({
                orderSyncId: orderSync.id,
                message: `Polling attempt ${pollAttempt}/${PAYMENT_CONFIG.jobPolling.maxAttempts} failed with network/API error: ${pollError.message}`,
                requestPayload: payload,
                responsePayload: {
                  error: pollError?.toString(),
                },
              })
              .catch((err) =>
                console.error(
                  "[Logger Error] Failed to log polling exception:",
                  err
                )
              );
          }
        }
      }

      if (!jobResolvedSuccessfully) {
        console.warn(
          `[Payment Capture] ⚠️ Polling completed without successful payment resolution | Order: ${shopifyOrderName}`
        );
      }
    } else {
      console.error(
        `[Payment Capture] ❌ Shopify did not return a paymentReferenceId | Order: ${shopifyOrderName}`
      );
    }

    if (!jobResolvedSuccessfully) {
      const failedReason =
        paymentStatusDetails?.errorMessage ||
        "Payment processing job failed to finish, timed out, or was declined.";

      console.error(
        `[Payment Capture] ❌ Payment was not successfully resolved | Order: ${shopifyOrderName} | Reason: ${failedReason}`
      );

      await syncLogger
        .failed({
          orderSyncId: orderSync.id,
          message: `Payment background check failed to confirm success. State details: ${failedReason}`,
          requestPayload: payload,
          responsePayload: {
            paymentStatus: paymentStatusDetails || {},
          },
        })
        .catch((err) =>
          console.error(
            "[Logger Error] Failed to log job unresolution:",
            err
          )
        );

      return json(
        {
          success: false,
          message: `Payment was declined or timed out. Details: ${failedReason}`,
          paymentStatusDetails,
        },
        { status: 402 }
      );
    }

    const finalPaymentReferenceId =
      paymentStatusDetails?.paymentReferenceId ||
      initialPaymentReferenceId;

    console.log(
      `[Payment Capture] ✅ PAYMENT SUCCESS CONFIRMED | Order: ${shopifyOrderName} | Reference: ${finalPaymentReferenceId} | Amount: ${amount}`
    );

    console.log(
      `[NetSuite Deposit] Starting Customer Deposit creation | Customer: ${netsuiteCustomerId} | Sales Order: ${netsuiteOrderId} | Amount: ${amount} | Payment Reference: ${finalPaymentReferenceId}`
    );

    // --- NETSUITE CUSTOMER DEPOSIT BLOCK START ---
    try {
      if (
        typeof netsuite !== "undefined" &&
        netsuiteCustomerId &&
        netsuiteOrderId
      ) {
        console.log(
          `[NetSuite Deposit] NetSuite client and required IDs validated.`
        );

        const depositPayload = {
          customer: {
            id: netsuiteCustomerId.toString(),
          },
          salesOrder: {
            id: netsuiteOrderId.toString(),
          },
          payment: Number(amount),
          memo: `Automated Deposit via Shopify Capture. Ref: ${finalPaymentReferenceId}`,
          [NETSUITE_CUSTOMER_DEPOSIT.fields.webPaymentTokenRef]: `${finalPaymentReferenceId}`,
          [NETSUITE_CUSTOMER_DEPOSIT.fields.businessUnit]: {
            id: NETSUITE_CUSTOMER_DEPOSIT.businessUnitId,
          },
          [NETSUITE_CUSTOMER_DEPOSIT.fields.paymentOption]: {
            id: NETSUITE_CUSTOMER_DEPOSIT.paymentOptionId,
          },
        };

        console.log(
          `[NetSuite Deposit] Creating Customer Deposit | Customer: ${netsuiteCustomerId} | Sales Order: ${netsuiteOrderId} | Payment: ${Number(
            amount
          )}`
        );

        const depositResult =
          await netsuite.createCustomerDeposit(depositPayload);

        console.log(
          `[NetSuite Deposit] Customer Deposit API completed | Success: ${Boolean(
            depositResult?.success
          )}`
        );

        if (depositResult.success) {
          console.log(
            `[NetSuite Deposit] ✅ Deposit created successfully | Sales Order: ${netsuiteOrderId}`
          );

          console.log(
            `[NetSuite Order Update] Starting order type update | Sales Order: ${netsuiteOrderId}`
          );

          const orderUpdateResult =
            await updateNetSuiteOrderTypeWithRetry(
              netsuiteOrderId
            );

          console.log(
            `[NetSuite Order Update] Order type update completed | Success: ${Boolean(
              orderUpdateResult?.success
            )}`
          );

          if (!orderUpdateResult.success) {
            console.error(
              `[NetSuite Order Update] ❌ Failed to update NetSuite order | Sales Order: ${netsuiteOrderId} | Error: ${getNetSuiteErrorMessage(
                orderUpdateResult
              )}`
            );

            await syncLogger
              .failed({
                orderSyncId: orderSync.id,
                eventType: "ORDER_STATUS_UPDATE",
                direction: "NETSUITE_TO_NETSUITE",
                message: getNetSuiteErrorMessage(
                  orderUpdateResult
                ),
                requestPayload: {
                  netsuiteOrderId,
                },
                responsePayload:
                  orderUpdateResult.data || {},
              })
              .catch((err) =>
                console.error(
                  "[Logger Error] Failed to log NetSuite order update failure:",
                  err
                )
              );
          } else {
            console.log(
              `[NetSuite Order Update] ✅ NetSuite sales order updated successfully | Sales Order: ${netsuiteOrderId}`
            );

            await syncLogger
              .success({
                orderSyncId: orderSync.id,
                eventType: "ORDER_STATUS_UPDATE",
                direction: "NETSUITE_TO_NETSUITE",
                message:
                  "NetSuite sales order set to Ready to wave",
                requestPayload: {
                  netsuiteOrderId,
                },
                responsePayload: orderUpdateResult,
              })
              .catch((err) =>
                console.error(
                  "[Logger Error] Failed to log NetSuite order update success:",
                  err
                )
              );
          }
        } else {
          console.error(
            `[NetSuite Deposit] ❌ NetSuite API rejected Customer Deposit | Sales Order: ${netsuiteOrderId}`
          );

          console.error(
            `[NetSuite Deposit] Rejection response:`,
            JSON.stringify(
              depositResult.data,
              null,
              2
            )
          );

          await syncLogger
            .failed({
              orderSyncId: orderSync.id,
              eventType: "CUSTOMER_DEPOSIT",
              direction: "SHOPIFY_TO_NETSUITE",
              message:
                "NetSuite rejected customer deposit creation.",
              requestPayload: depositPayload,
              responsePayload:
                depositResult.data || {},
            })
            .catch((err) =>
              console.error(
                "[Logger Error] Failed to log NetSuite deposit rejection:",
                err
              )
            );
        }
      } else if (typeof netsuite === "undefined") {
        console.error(
          "[NetSuite Deposit] ❌ 'netsuite' object is undefined. Check your server file import."
        );
      } else {
        console.error(
          `[NetSuite Deposit] ❌ Missing required NetSuite IDs | Customer: ${netsuiteCustomerId} | Sales Order: ${netsuiteOrderId}`
        );
      }
    } catch (nsError) {
      console.error(
        `[NetSuite Deposit] ❌ Critical error during deposit creation | Order: ${shopifyOrderName} | Sales Order: ${netsuiteOrderId}:`,
        nsError
      );

      if (orderSync?.id) {
        await syncLogger
          .failed({
            orderSyncId: orderSync.id,
            eventType: "CUSTOMER_DEPOSIT",
            direction: "SHOPIFY_TO_NETSUITE",
            message: `Critical exception in NetSuite integration block: ${nsError.message}`,
            requestPayload: {
              shopifyOrderName,
            },
            responsePayload: {
              error: nsError?.toString(),
            },
          })
          .catch((err) =>
            console.error(
              "[Logger Error] Failed to log NetSuite block exception:",
              err
            )
          );
      }
    }
    // --- NETSUITE CUSTOMER DEPOSIT BLOCK END ---

    console.log(
      `[Payment Capture] Updating payment capture time in database | OrderSync ID: ${orderSync.id}`
    );

    await orderRepository.updatePaymentCaptureTime(
      orderSync.id
    );

    console.log(
      `[Payment Capture] ✅ Payment capture time updated | OrderSync ID: ${orderSync.id}`
    );

    console.log(
      `[Payment Capture] Creating final success log | Order: ${shopifyOrderName} | Reference: ${finalPaymentReferenceId}`
    );

    await syncLogger
      .success({
        orderSyncId: orderSync.id,
        message: `Payment of ${amount} successfully settled. Ref: ${finalPaymentReferenceId}`,
        requestPayload: payload,
        responsePayload: captureResponse?.data || {},
      })
      .catch((err) =>
        console.error(
          "[Logger Error] Failed to log final success:",
          err
        )
      );

    console.log(
      `[Payment Capture] Saving payment sync record | Shopify Order: ${orderSync.shopifyOrderId} | NetSuite Order: ${orderSync.netsuiteOrderId} | Reference: ${finalPaymentReferenceId}`
    );

    await paymentRepository.createPaymentSync({
      netsuiteOrderId: orderSync.netsuiteOrderId,
      shopifyOrderId: orderSync.shopifyOrderId,
      authorizationId: shopifyOrderName,
      paymentReference: finalPaymentReferenceId,
      capturedAmount: Number(amount),
      status: "SUCCESS",
    });

    console.log(
      `[Payment Capture] ✅ Payment sync record created successfully | Order: ${shopifyOrderName}`
    );

    console.log(
      `[Payment Capture] ✅ FLOW COMPLETED SUCCESSFULLY | Order: ${shopifyOrderName} | Amount: ${amount} | Reference: ${finalPaymentReferenceId}`
    );

    console.log(
      "[Payment Capture] ========================================"
    );

    return json({
      success: true,
      paymentReferenceId: finalPaymentReferenceId,
      status: "SUCCESS",
    });
  } catch (error) {
    console.error(
      "[Hybrid Capture] ❌ CRITICAL EXCEPTION THROWN:",
      error
    );

    console.error(
      `[Hybrid Capture] Error details | Order: ${
        payload?.shopifyOrderName || "UNKNOWN"
      } | NetSuite Order: ${
        payload?.netsuiteSalesOrderId || "UNKNOWN"
      } | Message: ${error?.message || "Unknown error"}`
    );

    if (orderSync?.id) {
      console.error(
        `[Hybrid Capture] Attempting emergency DB failure log | OrderSync ID: ${orderSync.id}`
      );

      await syncLogger
        .failed({
          orderSyncId: orderSync.id,
          message: `Critical system failure: ${error.message}`,
          requestPayload: payload || {},
          responsePayload: {
            exception: error?.toString(),
          },
        })
        .catch((err) =>
          console.error(
            "[Emergency Logger Error] Failed to create emergency failure log:",
            err
          )
        );
    } else {
      console.error(
        "[Emergency Log Backup] Could not log to DB because orderSync was null. Payload Backup:",
        JSON.stringify(payload)
      );
    }

    console.error(
      "[Payment Capture] ========================================"
    );
    console.error("[Payment Capture] FLOW FAILED");

    return json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 }
    );
  }
}