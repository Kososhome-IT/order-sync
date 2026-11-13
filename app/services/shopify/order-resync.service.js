import prisma from "../../db.server";
import { unauthenticated, sessionStorage } from "../../shopify.server";
import { SHOPIFY_CONFIG } from "../../constants/integrationConfig";
import { getOrderSource } from "./orderSource.service";
import { processShopifyOrder } from "../netsuite/orderSync.service";

const CURSOR_SCOPE = "SHOPIFY_ORDER_RESYNC";
const PAGE_SIZE = 250;

function logResync(level, message, details = {}) {
  const write = console[level] || console.log;
  write(`[ORDER_RESYNC] ${JSON.stringify({
    component: "order-resync",
    timestamp: new Date().toISOString(),
    message,
    ...details,
  })}`);
}

function nextPageUrl(linkHeader) {
  const nextLink = linkHeader?.split(",").find((part) => part.includes('rel="next"'));
  return nextLink?.match(/<([^>]+)>/)?.[1] || null;
}

async function fetchShopifyPage(url, accessToken) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Shopify-Access-Token": accessToken },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.errors || `Shopify order listing failed with HTTP ${response.status}`);
  }
  return { orders: data.orders || [], next: nextPageUrl(response.headers.get("link")) };
}

async function hasLatestFailedOrderCreate(orderSyncId) {
  return prisma.orderSyncLog.findFirst({
    where: {
      orderSyncId,
      eventType: { in: ["ORDER_CREATE", "CREATE"] },
      status: { in: ["FAILED", "SUCCESS"] },
    },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  }).then((latest) => latest?.status === "FAILED");
}

async function processOne({ order, existing, shop }) {
  const shopifyOrderId = String(order.id);
  let orderSync = existing;
  let created = false;

  if (!orderSync) {
    try {
      orderSync = await prisma.orderSync.create({
        data: {
          shopifyOrderId,
          shopifyOrderName: order.name || null,
          originSystem: "SHOPIFY",
          lastSyncedFrom: "SHOPIFY",
          status: "PENDING",
          webhookPayload: order,
        },
      });
      created = true;
    } catch (error) {
      if (error.code !== "P2002") throw error;
      orderSync = await prisma.orderSync.findUnique({ where: { shopifyOrderId } });
      if (!orderSync) throw error;
    }
  }

  if (orderSync.netsuiteOrderId || orderSync.status === "SUCCESS" || orderSync.status === "PROCESSING") {
    return { outcome: "skipped", shopifyOrderId, reason: orderSync.status };
  }
  if (!created && !(orderSync.status === "FAILED" && await hasLatestFailedOrderCreate(orderSync.id))) {
    return { outcome: "skipped", shopifyOrderId, reason: orderSync.status };
  }

  // The conditional claim serializes webhook, manual retry, and resync workers.
  const claim = await prisma.orderSync.updateMany({
    where: {
      id: orderSync.id,
      status: orderSync.status,
      netsuiteOrderId: null,
    },
    data: { status: "PROCESSING", webhookPayload: order },
  });
  if (!claim.count) return { outcome: "skipped", shopifyOrderId, reason: "claimed elsewhere" };

  try {
    const { admin } = await unauthenticated.admin(shop);
    const source = await getOrderSource(admin, order.id);
    if (source === "NETSUITE") {
      await prisma.orderSync.update({ where: { id: orderSync.id }, data: { status: "SKIPPED" } });
      return { outcome: "skipped", shopifyOrderId, reason: "NETSUITE source" };
    }
    await processShopifyOrder(orderSync.id, { shopifyOrder: order });
    return { outcome: created ? "created" : "retried", shopifyOrderId, orderSyncId: orderSync.id };
  } catch (error) {
    const markedFailed = await prisma.orderSync.updateMany({
      where: { id: orderSync.id, status: "PROCESSING", netsuiteOrderId: null },
      data: { status: "FAILED", errorMessage: error.message },
    });
    if (markedFailed.count) {
      await prisma.orderSyncLog.create({
        data: {
          orderSyncId: orderSync.id,
          sourceSystem: "SHOPIFY",
          direction: "SHOPIFY_TO_NETSUITE",
          eventType: "ORDER_CREATE",
          status: "FAILED",
          message: error.message,
          errorPayload: { message: error.message },
        },
      });
    }
    return { outcome: "failed", shopifyOrderId, orderSyncId: orderSync.id, error: error.message };
  }
}

export async function runOrderResync() {
  const shop = process.env.SHOP;
  if (!shop) throw new Error("SHOP environment variable is required");
  const session = await sessionStorage.loadSession(`offline_${shop}`);
  if (!session?.accessToken) throw new Error("Offline Shopify session not found");

  await prisma.orderResyncCursor.upsert({
    where: { scope: CURSOR_SCOPE },
    create: { scope: CURSOR_SCOPE },
    update: {},
  });
  // Recover the global lock if a previous process died without running its finally block.
  await prisma.orderResyncCursor.updateMany({
    where: { scope: CURSOR_SCOPE, isRunning: true, updatedAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    data: { isRunning: false },
  });
  const acquired = await prisma.orderResyncCursor.updateMany({
    where: { scope: CURSOR_SCOPE, isRunning: false },
    data: { isRunning: true },
  });
  if (!acquired.count) throw new Error("An order resync is already running");

  const cursor = await prisma.orderResyncCursor.findUnique({ where: { scope: CURSOR_SCOPE } });
  let run;
  const results = [];
  let pageUrl = `https://${shop}/admin/api/${SHOPIFY_CONFIG.apiVersions.adminRest}/orders.json?status=any&limit=${PAGE_SIZE}&since_id=${encodeURIComponent(cursor.lastOrderId)}&order=created_at%20asc`;
  let cursorEnd = cursor.lastOrderId;

  try {
    run = await prisma.orderResyncRun.create({ data: { cursorStart: cursor.lastOrderId } });
    logResync("info", "Resync run started", { runId: run.id, shop, cursorStart: cursor.lastOrderId });
    let pageNumber = 0;
    while (pageUrl) {
      const { orders, next } = await fetchShopifyPage(pageUrl, session.accessToken);
      pageNumber += 1;
      logResync("info", "Fetched Shopify orders page", {
        runId: run.id, pageNumber, pageOrderCount: orders.length, processedCount: results.length,
      });
      const ids = orders.map((order) => String(order.id));
      const existingRecords = ids.length
        ? await prisma.orderSync.findMany({ where: { shopifyOrderId: { in: ids } } })
        : [];
      const byShopifyId = new Map(existingRecords.map((record) => [record.shopifyOrderId, record]));
      for (const order of orders) {
        const result = await processOne({ order, existing: byShopifyId.get(String(order.id)), shop });
        results.push(result);
        logResync(result.outcome === "failed" ? "error" : "info", "Processed Shopify order", {
          runId: run.id, pageNumber, ...result,
          progress: { processed: results.length, created: results.filter((r) => r.outcome === "created").length,
            retried: results.filter((r) => r.outcome === "retried").length,
            skipped: results.filter((r) => r.outcome === "skipped").length,
            failed: results.filter((r) => r.outcome === "failed").length },
        });
        await prisma.orderResyncRun.update({
          where: { id: run.id },
          data: { fetchedCount: results.length, createdCount: results.filter((r) => r.outcome === "created").length,
            retriedCount: results.filter((r) => r.outcome === "retried").length,
            successfulCount: results.filter((r) => ["created", "retried"].includes(r.outcome)).length,
            skippedCount: results.filter((r) => r.outcome === "skipped").length,
            failedCount: results.filter((r) => r.outcome === "failed").length, results },
        });
      }
      if (orders.length) cursorEnd = String(orders[orders.length - 1].id);
      logResync("info", "Finished Shopify orders page", { runId: run.id, pageNumber, cursorEnd, hasNextPage: Boolean(next) });
      pageUrl = next;
    }

    const failedCount = results.filter((result) => result.outcome === "failed").length;
    // Keep the prior cursor when any order failed so the next run can retry it.
    if (!failedCount) {
      await prisma.orderResyncCursor.update({ where: { scope: CURSOR_SCOPE }, data: { lastOrderId: cursorEnd } });
      logResync("info", "Advanced resync cursor", { runId: run.id, cursorStart: cursor.lastOrderId, cursorEnd });
    } else {
      logResync("warn", "Kept resync cursor in place because orders failed", {
        runId: run.id, cursor: cursor.lastOrderId, failedCount,
      });
    }
    const summary = {
      runId: run.id, fetched: results.length,
      created: results.filter((r) => r.outcome === "created").length,
      retried: results.filter((r) => r.outcome === "retried").length,
      successful: results.filter((r) => ["created", "retried"].includes(r.outcome)).length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      failed: failedCount, cursorStart: cursor.lastOrderId, cursorEnd: failedCount ? cursor.lastOrderId : cursorEnd,
      results,
    };
    await prisma.orderResyncRun.update({ where: { id: run.id }, data: {
      status: failedCount ? "COMPLETED_WITH_ERRORS" : "SUCCESS", cursorEnd: summary.cursorEnd,
      completedAt: new Date(), results: summary,
    } });
    const summaryLog = {
      runId: summary.runId, fetched: summary.fetched, created: summary.created,
      retried: summary.retried, successful: summary.successful, skipped: summary.skipped,
      failed: summary.failed, cursorStart: summary.cursorStart, cursorEnd: summary.cursorEnd,
    };
    logResync(failedCount ? "warn" : "info", "Resync run completed", summaryLog);
    return summary;
  } catch (error) {
    logResync("error", "Resync run failed", { runId: run?.id || null, cursor: cursor.lastOrderId,
      processedCount: results.length, error: error.message, stack: error.stack });
    if (run) await prisma.orderResyncRun.update({ where: { id: run.id }, data: {
      status: "FAILED", cursorEnd: cursor.lastOrderId, completedAt: new Date(), errorMessage: error.message,
      results: { cursorStart: cursor.lastOrderId, results },
    } }).catch(() => {});
    throw error;
  } finally {
    await prisma.orderResyncCursor.update({ where: { scope: CURSOR_SCOPE }, data: { isRunning: false } });
    logResync("info", "Released resync lock", { runId: run?.id || null });
  }
}
