import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceLogger } from "../services/common/logger";
import { query } from "../db/client";

const log = createServiceLogger("shopify-webhook");

// ---------------------------------------------------------------------------
// HMAC Verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC signature on an incoming Shopify webhook.
 *
 * Shopify signs webhooks using HMAC-SHA256 with the app's API secret. The
 * signature is sent in the `X-Shopify-Hmac-Sha256` header as a
 * base64-encoded digest.
 *
 * Uses `timingSafeEqual` to prevent timing attacks.
 *
 * @param body   - Raw request body (string, **not** parsed JSON)
 * @param hmac   - Value from the `X-Shopify-Hmac-Sha256` header
 * @param secret - The Shopify app API secret key
 * @returns `true` if the signature is valid
 */
export function verifyWebhookHmac(
  body,
  hmac,
  secret,
) {
  try {
    const computed = createHmac("sha256", secret).update(body, "utf8").digest("base64");

    const hmacBuffer = Buffer.from(hmac, "base64");
    const computedBuffer = Buffer.from(computed, "base64");

    if (hmacBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(hmacBuffer, computedBuffer);
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "HMAC verification failed with exception",
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook Parsing
// ---------------------------------------------------------------------------

/**
 * Extract Shopify webhook metadata from the incoming request headers.
 *
 * All values are taken from the standard `X-Shopify-*` headers.
 */
export function parseWebhookHeaders(
  headers,
) {
  const get = (name) => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? "";
    }
    // Support plain objects (e.g. from Express or tests)
    return headers[name] ?? "";
  };

  return {
    topic: get("x-shopify-topic"),
    domain: get("x-shopify-shop-domain"),
    webhookId: get("x-shopify-webhook-id"),
    hmac: get("x-shopify-hmac-sha256"),
    apiVersion: get("x-shopify-api-version"),
  };
}

/**
 * Parse and verify a webhook request in a single step.
 *
 * Returns the parsed webhook on success, or `null` if HMAC verification
 * fails.
 *
 * @param request  - Incoming Request (Fetch API compatible)
 * @param secret   - The Shopify app API secret
 */
export async function parseAndVerifyWebhook(
  request,
  secret,
) {
  const rawBody = await request.text();
  const webhookHeaders = parseWebhookHeaders(request.headers);

  if (!webhookHeaders.hmac) {
    log.warn({ topic: webhookHeaders.topic }, "Webhook missing HMAC header");
    return null;
  }

  if (!verifyWebhookHmac(rawBody, webhookHeaders.hmac, secret)) {
    log.warn(
      { topic: webhookHeaders.topic, domain: webhookHeaders.domain },
      "Webhook HMAC verification failed",
    );
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.error({ topic: webhookHeaders.topic }, "Failed to parse webhook body as JSON");
    return null;
  }

  return { headers: webhookHeaders, payload, rawBody };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * Check whether a webhook with the given ID has already been processed.
 *
 * Queries the `webhook_events` table. If the row exists, the webhook has
 * already been handled and processing should be skipped to guarantee
 * at-most-once semantics.
 *
 * @param webhookId - The unique webhook delivery ID from Shopify's
 *                    `X-Shopify-Webhook-Id` header.
 * @returns `true` if this webhook has **already** been processed.
 */
export async function isWebhookProcessed(webhookId) {
  const result = await query(
    `SELECT id FROM webhook_events WHERE webhook_id = $1 LIMIT 1`,
    [webhookId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Record a webhook as processed in the `webhook_events` table.
 *
 * Should be called **after** the webhook has been successfully handled so
 * that retries for the same delivery ID are skipped.
 */
export async function markWebhookProcessed(
  webhookId,
  topic,
  shopDomain,
) {
  await query(
    `INSERT INTO webhook_events (webhook_id, topic, shop_domain, processed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (webhook_id) DO NOTHING`,
    [webhookId, topic, shopDomain],
  );

  log.debug({ webhookId, topic, shopDomain }, "Webhook marked as processed");
}

/**
 * Helper that combines the idempotency check with early-exit logic.
 *
 * Returns `true` if processing should proceed (webhook is new), or `false`
 * if the webhook has already been handled.
 */
export async function shouldProcessWebhook(webhookId) {
  if (!webhookId) {
    log.warn("Webhook ID missing, cannot check idempotency -- allowing processing");
    return true;
  }

  const processed = await isWebhookProcessed(webhookId);

  if (processed) {
    log.info({ webhookId }, "Duplicate webhook delivery detected, skipping");
    return false;
  }

  return true;
}
