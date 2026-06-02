import { createHash } from "node:crypto";
import { query } from "../../../db/client";

export function generateIdempotencyKey(...parts) {
  const data = parts.filter(Boolean).join(":");
  return createHash("sha256").update(data).digest("hex");
}

export async function hasBeenProcessed(
  idempotencyKey,
  syncRunId,
) {
  const result = await query(
    `SELECT id FROM sync_logs
     WHERE sync_run_id != $1
       AND status = 'success'
       AND created_at > NOW() - INTERVAL '24 hours'
       AND encode(digest(CONCAT(sync_run_id, shopify_id, netsuite_id), 'sha256'), 'hex') = $2
     LIMIT 1`,
    [syncRunId, idempotencyKey],
  );
  return (result.rowCount || 0) > 0;
}

export async function isWebhookProcessed(webhookId) {
  const result = await query(
    "SELECT id FROM webhook_events WHERE webhook_id = $1 AND status = 'processed'",
    [webhookId],
  );
  return (result.rowCount || 0) > 0;
}

export async function recordWebhookReceived(
  webhookId,
  topic,
  shopifyId,
  payloadHash,
) {
  try {
    await query(
      `INSERT INTO webhook_events (webhook_id, topic, shopify_id, payload_hash, status)
       VALUES ($1, $2, $3, $4, 'received')`,
      [webhookId, topic, shopifyId, payloadHash],
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return false;
    }
    throw error;
  }
}

export async function markWebhookProcessed(webhookId) {
  await query(
    "UPDATE webhook_events SET status = 'processed', processed_at = NOW() WHERE webhook_id = $1",
    [webhookId],
  );
}

export async function markWebhookFailed(webhookId) {
  await query(
    "UPDATE webhook_events SET status = 'failed' WHERE webhook_id = $1",
    [webhookId],
  );
}

export async function cleanupOldWebhookEvents(daysToKeep = 30) {
  const result = await query(
    "DELETE FROM webhook_events WHERE created_at < NOW() - INTERVAL '1 day' * $1",
    [daysToKeep],
  );
  return result.rowCount || 0;
}
