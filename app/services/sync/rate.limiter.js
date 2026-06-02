import { createServiceLogger } from "../services/common/logger";
import { RATE_LIMITS } from "../utils/constants";
import { sleep } from "../services/common/retry";

const log = createServiceLogger("rate-limiter");

export class ShopifyRateLimiter {
  constructor() {
    this.currentlyAvailable = 1000;
    this.restoreRate = 50;
    this.maximumAvailable = 1000;
    this.threshold = RATE_LIMITS.SHOPIFY_COST_THRESHOLD;
  }

  updateFromResponse(cost) {
    this.currentlyAvailable = cost.throttleStatus.currentlyAvailable;
    this.restoreRate = cost.throttleStatus.restoreRate;
    this.maximumAvailable = cost.throttleStatus.maximumAvailable;
  }

  async throttleIfNeeded() {
    if (this.currentlyAvailable < this.threshold) {
      const pointsNeeded = this.threshold - this.currentlyAvailable;
      const waitMs = (pointsNeeded / this.restoreRate) * 1000;
      log.info(
        { currentlyAvailable: this.currentlyAvailable, waitMs: Math.round(waitMs) },
        "Shopify rate limit approaching, throttling",
      );
      await sleep(waitMs);
      this.currentlyAvailable += pointsNeeded;
    }
  }

  getStatus() {
    return {
      currentlyAvailable: this.currentlyAvailable,
      maximumAvailable: this.maximumAvailable,
      restoreRate: this.restoreRate,
      utilizationPercent: Math.round(
        ((this.maximumAvailable - this.currentlyAvailable) / this.maximumAvailable) * 100,
      ),
    };
  }
}

export class NetSuiteRateLimiter {
  constructor() {
    this.activeRequests = 0;
    this.maxConcurrent = RATE_LIMITS.NETSUITE_MAX_CONCURRENT;
    this.queue = [];
  }

  async acquire() {
    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  release() {
    this.activeRequests--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  async withLimit(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  getStatus() {
    return {
      activeRequests: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      queuedRequests: this.queue.length,
    };
  }
}

export const shopifyRateLimiter = new ShopifyRateLimiter();
export const netsuiteRateLimiter = new NetSuiteRateLimiter();
