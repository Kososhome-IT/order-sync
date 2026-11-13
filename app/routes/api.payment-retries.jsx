/* global process */
import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { runPaymentAttempt } from "../services/payment-retry.server";
import {
  failureReasonFromLog,
  isRetryablePaymentFailure,
  nextPacificRetryAt,
  normalizePaymentAttemptDateTime,
  paymentKey,
} from "../services/payment-retry-policy.server";
import { syncLogger } from "../repositories/logger.service";

const MAX_ATTEMPTS = 2;
const CURSOR_SCOPE = "PAYMENT_CAPTURE";
const LOG_BATCH_SIZE = 250;

function initialPaymentRetryCursor() {
  const configured = process.env.PAYMENT_RETRY_INITIAL_LOG_ID;
  if (configured === undefined || configured.trim() === "") return 0;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("PAYMENT_RETRY_INITIAL_LOG_ID must be a non-negative integer");
  }
  return value;
}

function authorized(request) {
  const secret = process.env.PAYMENT_RETRY_CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function logPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function advanceCursor(cursorId, logId) {
  await prisma.paymentRetryCursor.update({ where: { id: cursorId }, data: { lastOrderSyncLogId: logId } });
}

async function ingestPaymentLog(log, runId) {
  const payload = logPayload(log.requestPayload);
  const paymentAttemptDateTime = normalizePaymentAttemptDateTime(payload.paymentAttemptDateTime)
    || log.createdAt.toISOString();
  const shop = payload.shop || process.env.SHOP;
  const reason = failureReasonFromLog(log);

  if (!paymentAttemptDateTime || !shop) {
    await syncLogger.log({
      orderSyncId: log.orderSyncId,
      eventType: "PAYMENT_RETRY_INGESTION",
      status: "SKIPPED",
      message: "Failed payment log was skipped because payment attempt date/time or shop is missing.",
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId },
    });
    return { sourceLogId: log.id, status: "SKIPPED", reason: "Missing payment attempt date/time or shop" };
  }

  if (!isRetryablePaymentFailure(reason)) {
    return { sourceLogId: log.id, status: "IGNORED", reason: "Permanent or non-retryable payment failure" };
  }

  const amount = payload.amount;
  if (amount === undefined || amount === null || amount === "" || !Number.isFinite(Number(amount))) {
    await syncLogger.log({
      orderSyncId: log.orderSyncId,
      eventType: "PAYMENT_RETRY_INGESTION",
      status: "SKIPPED",
      message: "Retryable payment failure was skipped because its amount is invalid.",
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId, paymentAttemptDateTime },
    });
    return { sourceLogId: log.id, status: "SKIPPED", reason: "Invalid payment amount" };
  }

  // Every failed PAYMENT_CAPTURE log is its own payment event and retry item.
  // The log primary key prevents separate captures on one order from merging.
  const key = `${String(shop).trim().toLowerCase()}:capture-log:${log.id}`;
  const attemptKey = paymentKey(shop, log.orderSyncId, paymentAttemptDateTime);
  let retry = await prisma.paymentRetry.findUnique({ where: { sourceOrderSyncLogId: log.id } });
  let createdFromThisLog = false;
  if (!retry) {
    try {
      retry = await prisma.paymentRetry.create({
        data: {
          orderSyncId: log.orderSyncId,
          paymentAttemptDateTime: new Date(paymentAttemptDateTime),
          paymentKey: key,
          sourceOrderSyncLogId: log.id,
          shopifyOrderId: String(log.orderSync.shopifyOrderId || ""),
          shopifyOrderName: log.orderSync.shopifyOrderName || payload.shopifyOrderName,
          netsuiteOrderId: payload.netsuiteSalesOrderId || log.orderSync.netsuiteOrderId,
          shop,
          amount: String(amount),
          currency: payload.currency || "USD",
          status: "PENDING",
          attemptCount: 0,
          maxAttempts: MAX_ATTEMPTS,
          nextRetryAt: nextPacificRetryAt(log.createdAt),
          lastError: reason,
          lastErrorCode: "RETRYABLE_PAYMENT_FAILURE",
        },
      });
      createdFromThisLog = true;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      retry = await prisma.paymentRetry.findUnique({ where: { sourceOrderSyncLogId: log.id } });
      if (!retry) throw error;
    }
  }

  await prisma.paymentAttempt.upsert({
    where: { paymentKey: attemptKey },
    create: {
      orderSyncId: log.orderSyncId,
      paymentAttemptDateTime: new Date(paymentAttemptDateTime),
      paymentKey: attemptKey,
      status: "FAILED",
      lastError: reason,
      lastAttemptAt: log.createdAt,
    },
    update: {},
  });

  if (createdFromThisLog) {
    await syncLogger.log({
      orderSyncId: log.orderSyncId,
      eventType: "PAYMENT_RETRY_INGESTION",
      status: "PENDING",
      message: `Retryable payment failure added to the retry queue for payment attempt ${paymentAttemptDateTime}.`,
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId, paymentAttemptDateTime },
      responsePayload: { paymentRetryId: retry.id, nextRetryAt: retry.nextRetryAt },
    });
  }

  return { sourceLogId: log.id, paymentRetryId: retry.id, status: createdFromThisLog ? "PENDING" : "DUPLICATE" };
}

export async function action({ request }) {
  if (!authorized(request)) {
    console.warn("[Payment Retry Scheduler] Unauthorized request rejected");
    return json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const schedulerJobName = request.headers.get("x-cloudscheduler-jobname");
  const run = await prisma.paymentRetryRun.create({ data: { schedulerJobName } });
  const now = new Date();
  console.log(`[Payment Retry Scheduler] Run ${run.id} started`, { schedulerJobName });

  try {
    let cursor = await prisma.paymentRetryCursor.findUnique({ where: { scope: CURSOR_SCOPE } });
    if (!cursor) {
      try {
        cursor = await prisma.paymentRetryCursor.create({
          data: {
            scope: CURSOR_SCOPE,
            lastOrderSyncLogId: initialPaymentRetryCursor(),
          },
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        cursor = await prisma.paymentRetryCursor.findUnique({ where: { scope: CURSOR_SCOPE } });
        if (!cursor) throw error;
      }
      console.log(`[Payment Retry Scheduler] Initialized cursor`, {
        cursorId: cursor.id,
        lastOrderSyncLogId: cursor.lastOrderSyncLogId,
      });
    }
    const stale = await prisma.paymentRetry.updateMany({
      where: { status: "PROCESSING", lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
      data: { status: "MANUAL_REVIEW", nextRetryAt: null, outcomeUnknown: true, lastError: "Retry process stopped before its result was recorded", lastErrorCode: "OUTCOME_UNKNOWN" },
    });
    const logs = await prisma.orderSyncLog.findMany({
      where: { id: { gt: cursor.lastOrderSyncLogId } },
      include: { orderSync: true },
      orderBy: { id: "asc" },
      take: LOG_BATCH_SIZE,
    });
    const ingestionResults = [];
    for (const log of logs) {
      if (log.eventType === "PAYMENT_CAPTURE" && log.status === "FAILED") {
        ingestionResults.push(await ingestPaymentLog(log, run.id));
      }
      await advanceCursor(cursor.id, log.id);
    }

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
        message: `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} started for payment attempt ${retry.paymentAttemptDateTime.toISOString()}.`,
        requestPayload: { paymentRetryId: retry.id, schedulerRunId: run.id, attempt, paymentAttemptDateTime: retry.paymentAttemptDateTime.toISOString() },
      });

      const outcome = await runPaymentAttempt(retry, attempt, key);
      const latest = await prisma.paymentRetry.findUnique({ where: { id: retry.id } });
      if (latest?.status !== "PROCESSING") {
        results.push({ id: retry.id, status: latest?.status });
        continue;
      }

      const exhausted = attempt >= MAX_ATTEMPTS;
      const isUnknown = Boolean(outcome.unknown);
      const retryable = Boolean(outcome.retryable) || isRetryablePaymentFailure(outcome.message);
      const nextRetryAt = isUnknown || !retryable || exhausted ? null : nextPacificRetryAt();
      const status = nextRetryAt ? "PENDING" : "MANUAL_REVIEW";
      await prisma.paymentRetry.update({
        where: { id: retry.id },
        data: {
          status,
          nextRetryAt,
          outcomeUnknown: isUnknown,
          lastError: outcome.message,
          lastErrorCode: isUnknown ? "OUTCOME_UNKNOWN" : retryable ? "PAYMENT_FAILED" : "PERMANENT_FAILURE",
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
      data: {
        status: "SUCCESS",
        dueCount: due.length,
        processedCount: results.length,
        results: { ingestion: ingestionResults, retries: results, recoveredStaleRetries: stale.count },
        completedAt: new Date(),
      },
    });
    console.log(`[Payment Retry Scheduler] Run ${run.id} completed`, { scannedLogs: logs.length, dueCount: due.length, processedCount: results.length, recoveredStaleRetries: stale.count });
    return json({ success: true, runId: run.id, scannedLogs: logs.length, ingested: ingestionResults.length, dueCount: due.length, processed: results.length, results });
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
