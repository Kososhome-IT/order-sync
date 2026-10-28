/* global process */
import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { runPaymentAttempt } from "../services/payment-retry.server";

const MAX_ATTEMPTS = 2;

function nextPacificRetryAt(from = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const current = Object.fromEntries(formatter.formatToParts(from).map(({ type, value }) => [type, value]));
  const target = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day) + 1, 7));
  const targetLocalEpoch = target.getTime();
  let candidate = new Date(targetLocalEpoch + 8 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = Object.fromEntries(formatter.formatToParts(candidate).map(({ type, value }) => [type, value]));
    const localEpoch = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
    candidate = new Date(candidate.getTime() + targetLocalEpoch - localEpoch);
  }
  return candidate;
}

function authorized(request) {
  const secret = process.env.PAYMENT_RETRY_CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function action({ request }) {
  if (!authorized(request)) return json({ success: false, message: "Unauthorized" }, { status: 401 });
  const now = new Date();
  await prisma.paymentRetry.updateMany({
    where: { status: "PROCESSING", lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
    data: { status: "MANUAL_REVIEW", nextRetryAt: null, outcomeUnknown: true, lastError: "Retry process stopped before its result was recorded", lastErrorCode: "OUTCOME_UNKNOWN" },
  });
  const due = await prisma.paymentRetry.findMany({
    where: { status: "PENDING", nextRetryAt: { lte: now }, attemptCount: { lt: MAX_ATTEMPTS } },
    orderBy: { nextRetryAt: "asc" },
  });

  const results = [];
  for (const retry of due) {
    const attempt = retry.attemptCount + 1;
    const key = `payment-retry-${retry.id}-${attempt}`;
    const claimed = await prisma.paymentRetry.updateMany({
      where: { id: retry.id, status: "PENDING", attemptCount: retry.attemptCount },
      data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastAttemptAt: now, idempotencyKey: key, outcomeUnknown: false },
    });
    if (!claimed.count) continue;

    const outcome = await runPaymentAttempt(retry, attempt, key);
    const latest = await prisma.paymentRetry.findUnique({ where: { id: retry.id } });
    // The capture route marks confirmed success and confirmed declines itself.
    if (latest?.status !== "PROCESSING") {
      results.push({ id: retry.id, status: latest?.status });
      continue;
    }

    const exhausted = attempt >= MAX_ATTEMPTS;
    const isUnknown = outcome.unknown;
    const nextRetryAt = isUnknown || !outcome.retryable || exhausted ? null : nextPacificRetryAt();
    await prisma.paymentRetry.update({
      where: { id: retry.id },
      data: {
        status: nextRetryAt ? "PENDING" : "MANUAL_REVIEW",
        nextRetryAt,
        outcomeUnknown: isUnknown,
        lastError: outcome.message,
        lastErrorCode: isUnknown ? "OUTCOME_UNKNOWN" : outcome.retryable ? "PAYMENT_FAILED" : "PERMANENT_FAILURE",
      },
    });
    results.push({ id: retry.id, status: nextRetryAt ? "PENDING" : "MANUAL_REVIEW" });
  }

  return json({ success: true, processed: results.length, results });
}
