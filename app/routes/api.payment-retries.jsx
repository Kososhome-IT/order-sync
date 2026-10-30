/* global process */
import { json } from "../utils/jsonResponse";
import prisma from "../db.server";
import { runPaymentAttempt } from "../services/payment-retry.server";
import {
  failureReasonFromLog,
  isRetryablePaymentFailure,
  nextPacificRetryAt,
  paymentInstructionIdFromPayload,
  paymentKey,
} from "../services/payment-retry-policy.server";
import { syncLogger } from "../repositories/logger.service";

const MAX_ATTEMPTS = 2;
const CURSOR_SCOPE = "PAYMENT_CAPTURE";
const LOG_BATCH_SIZE = 250;

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
  const instructionId = paymentInstructionIdFromPayload(payload);
  const shop = payload.shop || process.env.SHOP;
  const reason = failureReasonFromLog(log);

  if (!instructionId || !shop) {
    await syncLogger.log({
      orderSyncId: log.orderSyncId,
      eventType: "PAYMENT_RETRY_INGESTION",
      status: "SKIPPED",
      message: "Failed payment log was skipped because paymentInstructionId or shop is missing.",
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId },
    });
    return { sourceLogId: log.id, status: "SKIPPED", reason: "Missing payment instruction identity" };
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
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId, paymentInstructionId: instructionId },
    });
    return { sourceLogId: log.id, status: "SKIPPED", reason: "Invalid payment amount" };
  }

  const key = paymentKey(shop, instructionId);
  const retry = await prisma.paymentRetry.upsert({
    where: { paymentKey: key },
    create: {
      orderSyncId: log.orderSyncId,
      paymentInstructionId: instructionId,
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
    update: {},
  });

  await prisma.paymentAttempt.upsert({
    where: { paymentKey: key },
    create: {
      orderSyncId: log.orderSyncId,
      paymentInstructionId: instructionId,
      paymentKey: key,
      status: "FAILED",
      lastError: reason,
      lastAttemptAt: log.createdAt,
    },
    update: {},
  });

  const createdFromThisLog = retry.sourceOrderSyncLogId === log.id;
  if (createdFromThisLog) {
    await syncLogger.log({
      orderSyncId: log.orderSyncId,
      eventType: "PAYMENT_RETRY_INGESTION",
      status: "PENDING",
      message: `Retryable payment failure added to the retry queue for payment instruction ${instructionId}.`,
      requestPayload: { sourceOrderSyncLogId: log.id, schedulerRunId: runId, paymentInstructionId: instructionId },
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
    const cursor = await prisma.paymentRetryCursor.upsert({
      where: { scope: CURSOR_SCOPE },
      create: { scope: CURSOR_SCOPE },
      update: {},
    });
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
        message: `Automatic payment retry ${attempt}/${MAX_ATTEMPTS} started for payment instruction ${retry.paymentInstructionId}.`,
        requestPayload: { paymentRetryId: retry.id, schedulerRunId: run.id, attempt, paymentInstructionId: retry.paymentInstructionId },
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
