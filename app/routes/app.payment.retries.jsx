import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function loader({ request }) {
  await authenticate.admin(request);
  const retries = await prisma.paymentRetry.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return jsonResponse({ retries: retries.map((retry) => ({ ...retry, amount: retry.amount.toString() })) });
}

export async function action({ request }) {
  await authenticate.admin(request);
  const form = await request.formData();
  const id = Number(form.get("id"));
  const retry = await prisma.paymentRetry.findUnique({ where: { id } });
  if (!retry || retry.status !== "MANUAL_REVIEW") {
    return jsonResponse({ success: false, message: "This payment is not ready for manual retry." }, 409);
  }

  const key = retry.outcomeUnknown && retry.idempotencyKey
    ? retry.idempotencyKey
    : `payment-manual-${retry.id}-${Date.now()}`;
  const claimed = await prisma.paymentRetry.updateMany({
    where: { id, status: "MANUAL_REVIEW" },
    data: { status: "PROCESSING", idempotencyKey: key, lastAttemptAt: new Date() },
  });
  if (!claimed.count) return jsonResponse({ success: false, message: "Payment retry is already in progress." }, 409);

  const { runManualPaymentRetry } = await import("../services/payment-retry.server");
  return runManualPaymentRetry(retry, key);
}

export default function PaymentRetryDashboard() {
  const { retries } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) revalidator.revalidate();
  }, [fetcher.state, fetcher.data, revalidator]);

  return (
    <s-page title="Payment Retries" inlineSize="large">
      <s-section>
        <s-paragraph>Failed charges, automatic retry schedule, and manual review status.</s-paragraph>
        {retries.length === 0 ? <s-text tone="subdued">No payment retries recorded.</s-text> : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header><s-table-header>Amount</s-table-header>
              <s-table-header>Status</s-table-header><s-table-header>Attempts</s-table-header>
              <s-table-header>Next retry</s-table-header><s-table-header>Last error</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {retries.map((retry) => <s-table-row key={retry.id}>
                <s-table-cell>{retry.shopifyOrderName || retry.shopifyOrderId}</s-table-cell>
                <s-table-cell>{retry.amount} {retry.currency || ""}</s-table-cell>
                <s-table-cell><s-badge tone={retry.status === "SUCCESS" ? "success" : retry.status === "MANUAL_REVIEW" ? "critical" : "attention"}>{retry.status}</s-badge></s-table-cell>
                <s-table-cell>{retry.attemptCount} / {retry.maxAttempts}</s-table-cell>
                <s-table-cell>{retry.nextRetryAt ? new Date(retry.nextRetryAt).toLocaleString() : "—"}</s-table-cell>
                <s-table-cell>{retry.lastError || "—"}</s-table-cell>
                <s-table-cell>
                  {retry.status === "MANUAL_REVIEW" ? <fetcher.Form method="post">
                    <input type="hidden" name="id" value={retry.id} />
                    <s-button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>Manual Retry</s-button>
                  </fetcher.Form> : "—"}
                </s-table-cell>
              </s-table-row>)}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
