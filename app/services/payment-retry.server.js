import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { action as capturePayment } from "../routes/netsuite.capture-payment";
import { SHOPIFY_CONFIG } from "../constants/integrationConfig";

function captureRequest(retry, attempt, key) {
  return new Request("https://internal.local/netsuite/capture-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shopifyOrderName: retry.shopifyOrderName,
      amount: retry.amount.toString(),
      currency: retry.currency || "USD",
      netsuiteSalesOrderId: retry.netsuiteOrderId,
      custbody_wmsse_ordertype: SHOPIFY_CONFIG.order.readyToChargeTypeName,
      shop: retry.shop || process.env.SHOP,
      paymentRetryId: retry.id,
      retryAttempt: attempt,
      idempotencyKey: key,
    }),
  });
}

export async function runPaymentAttempt(retry, attempt, key) {
  try {
    const response = await capturePayment({ request: captureRequest(retry, attempt, key) });
    const result = await response.json();
    if (response.ok && result.success) return { success: true };
    return {
      success: false,
      retryable: Boolean(result.retryable),
      unknown: Boolean(result.outcomeUnknown),
      message: result.message || result.errors?.map((error) => error.message).join(", ") || "Payment retry failed",
    };
  } catch (error) {
    return { success: false, unknown: true, message: error?.message || "Payment result could not be confirmed" };
  }
}

export async function runManualPaymentRetry(retry, key) {
  const outcome = await runPaymentAttempt(retry, retry.attemptCount + 1, key);
  const latest = await prisma.paymentRetry.findUnique({ where: { id: retry.id } });
  if (latest?.status === "PROCESSING") {
    await prisma.paymentRetry.update({
      where: { id: retry.id },
      data: {
        status: "MANUAL_REVIEW",
        nextRetryAt: null,
        outcomeUnknown: Boolean(outcome.unknown),
        lastError: outcome.message,
        lastErrorCode: outcome.unknown ? "OUTCOME_UNKNOWN" : "MANUAL_RETRY_FAILED",
      },
    });
  }
  return json({ success: outcome.success, message: outcome.message || "Manual retry completed" }, { status: outcome.success ? 200 : 422 });
}
