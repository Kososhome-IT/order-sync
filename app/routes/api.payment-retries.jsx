/* global process */
import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { runPaymentAttempt } from "../services/payment-retry.server";
import { syncLogger } from "../repositories/logger.service";

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
  if (!authorized(request)) {
    console.warn("[Payment Retry Scheduler] Unauthorized request rejected");
    return json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const schedulerJobName = request.headers.get("x-cloudscheduler-jobname");
  const run = await prisma.paymentRetryRun.create({
    data: { schedulerJobName },
  });
  const now = new Date();
  console.log(`[Payment Retry Scheduler] Run ${run.id} started`, { schedulerJobName });

  try {
    const stale = await prisma.paymentRetry.updateMany({
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

      await syncLogger.log({
        orderSyncId: retry.orderSyncId,
        eventType: "PAYMENT_RETRY",
        status: "PROCESSING",
        message: `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} started by scheduler.`,
        requestPayload: { paymentRetryId: retry.id, schedulerRunId: run.id, attempt },
      });

      const outcome = await runPaymentAttempt(retry, attempt, key);
      const latest = await prisma.paymentRetry.findUnique({ where: { id: retry.id } });
      // The capture route marks confirmed success and confirmed declines itself.
      if (latest?.status !== "PROCESSING") {
        await syncLogger.log({
          orderSyncId: retry.orderSyncId,
          eventType: "PAYMENT_RETRY",
          status: latest?.status === "SUCCESS" ? "SUCCESS" : "FAILED",
          message: `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} finished with ${latest?.status || "UNKNOWN"}.`,
          responsePayload: { paymentRetryId: retry.id, schedulerRunId: run.id, status: latest?.status },
        });
        results.push({ id: retry.id, status: latest?.status });
        continue;
      }

      const exhausted = attempt >= MAX_ATTEMPTS;
      const isUnknown = outcome.unknown;
      const nextRetryAt = isUnknown || !outcome.retryable || exhausted ? null : nextPacificRetryAt();
      const status = nextRetryAt ? "PENDING" : "MANUAL_REVIEW";
      await prisma.paymentRetry.update({
        where: { id: retry.id },
        data: {
          status,
          nextRetryAt,
          outcomeUnknown: isUnknown,
          lastError: outcome.message,
          lastErrorCode: isUnknown ? "OUTCOME_UNKNOWN" : outcome.retryable ? "PAYMENT_FAILED" : "PERMANENT_FAILURE",
        },
      });
      await syncLogger.log({
        orderSyncId: retry.orderSyncId,
        eventType: "PAYMENT_RETRY",
        status: status === "PENDING" ? "PENDING" : "FAILED",
        message: status === "PENDING"
          ? `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} failed and was scheduled for the next 7:00 AM Pacific run.`
          : `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} needs manual review: ${outcome.message}`,
        responsePayload: { paymentRetryId: retry.id, schedulerRunId: run.id, status, error: outcome.message },
      });
      results.push({ id: retry.id, status });
    }

    await prisma.paymentRetryRun.update({
      where: { id: run.id },
      data: { status: "SUCCESS", dueCount: due.length, processedCount: results.length, results, completedAt: new Date() },
    });
    console.log(`[Payment Retry Scheduler] Run ${run.id} completed`, { dueCount: due.length, processedCount: results.length, recoveredStaleRetries: stale.count });
    return json({ success: true, runId: run.id, dueCount: due.length, processed: results.length, results });
  } catch (error) {
    const message = error?.message || "Unexpected payment retry scheduler error";
    console.error(`[Payment Retry Scheduler] Run ${run.id} failed`, error);
    await prisma.paymentRetryRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    }).catch((logError) => console.error("[Payment Retry Scheduler] Unable to save failed run", logError));
    return json({ success: false, runId: run.id, message }, { status: 500 });
  }
}
