import { createServiceLogger } from "../services/common/logger";
import { ShopifyError, ShopifyRateLimitError } from "../services/common/errors";
import { RATE_LIMITS } from "../utils/constants";
import { apiVersion } from "../shopify.server";
import { sleep } from "../services/common/retry";

const log = createServiceLogger("shopify-client");

/**
 * GraphQL client for background workers that operate outside of Remix request
 * context. Routes should use `authenticate.admin()` from shopify-app-remix
 * instead.
 */
export class ShopifyClient {
  constructor(shop, accessToken) {
    this.shop = shop;
    this.accessToken = accessToken;
    this.endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  }

  /**
   * Execute a GraphQL request against the Shopify Admin API.
   *
   * Automatically tracks query cost from `extensions.cost` and pauses
   * execution when `currentlyAvailable` drops below the configured
   * SHOPIFY_COST_THRESHOLD to avoid 429s.
   */
  async graphqlRequest(
    query,
    variables,
  ) {
    const body = JSON.stringify({ query, variables });

    log.debug({ shop: this.shop, queryLength: query.length }, "Executing GraphQL request");

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.accessToken,
        },
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ shop: this.shop, error: message }, "GraphQL network error");
      throw new ShopifyError(`Network error calling Shopify: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "Unable to read response body");
      log.error(
        { shop: this.shop, status: response.status, body: text },
        "GraphQL HTTP error",
      );
      throw new ShopifyError(
        `Shopify responded with HTTP ${response.status}: ${text}`,
        undefined,
        response.status,
      );
    }

    const json = await response.json();

    // Surface top-level GraphQL errors (schema/syntax errors, not userErrors)
    const gqlErrors = json.errors;
    if (gqlErrors?.length) {
      const combined = gqlErrors.map((e) => e.message).join("; ");
      log.error({ shop: this.shop, errors: gqlErrors }, "GraphQL query errors");
      throw new ShopifyError(`GraphQL errors: ${combined}`);
    }

    // Track rate limit cost and throttle proactively
    await this.handleThrottle(json.extensions);

    return json.data;
  }

  /**
   * Inspect the cost extension returned by Shopify and sleep if the bucket
   * is getting low, so that the next request doesn't get throttled.
   */
  async handleThrottle(
    extensions,
  ) {
    if (!extensions?.cost) return;

    const { actualQueryCost, throttleStatus } = extensions.cost;
    const { currentlyAvailable, restoreRate, maximumAvailable } = throttleStatus;

    log.debug(
      {
        actualQueryCost,
        currentlyAvailable,
        restoreRate,
        maximumAvailable,
      },
      "GraphQL cost tracking",
    );

    if (currentlyAvailable < RATE_LIMITS.SHOPIFY_COST_THRESHOLD) {
      // Calculate how long to wait for the bucket to refill above the threshold
      const deficit = RATE_LIMITS.SHOPIFY_COST_THRESHOLD - currentlyAvailable;
      const waitMs = Math.ceil((deficit / restoreRate) * 1000);

      log.warn(
        { currentlyAvailable, threshold: RATE_LIMITS.SHOPIFY_COST_THRESHOLD, waitMs },
        "Approaching Shopify rate limit, sleeping to restore budget",
      );

      throw new ShopifyRateLimitError(currentlyAvailable, restoreRate);
    }
  }

  /** The shop domain this client is configured for. */
  get shopDomain() {
    return this.shop;
  }
}

/**
 * Factory for creating a ShopifyClient in background workers. The access
 * token should be the offline token stored during app installation.
 */
export function createShopifyClient(shop, accessToken) {
  if (!shop) throw new Error("shop domain is required to create a ShopifyClient");
  if (!accessToken) throw new Error("accessToken is required to create a ShopifyClient");
  return new ShopifyClient(shop, accessToken);
}
