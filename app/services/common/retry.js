import { isRetryableError, NetSuiteRateLimitError } from "./errors";
import { createServiceLogger } from "./logger";
import { RETRY_CONFIG } from "../utils/constants";

const log = createServiceLogger("retry");

export async function withRetry(
  fn,
  options = {},
) {
  const {
    maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS,
    initialDelayMs = RETRY_CONFIG.INITIAL_DELAY_MS,
    maxDelayMs = RETRY_CONFIG.MAX_DELAY_MS,
    backoffMultiplier = RETRY_CONFIG.BACKOFF_MULTIPLIER,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      let delayMs;

      if (error instanceof NetSuiteRateLimitError) {
        delayMs = error.retryAfter * 1000;
      } else {
        delayMs = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
        delayMs = delayMs * (0.5 + Math.random() * 0.5);
      }

      log.warn(
        { attempt, maxAttempts, delayMs, error: error instanceof Error ? error.message : String(error) },
        `Retry attempt ${attempt}/${maxAttempts}, waiting ${Math.round(delayMs)}ms`,
      );

      onRetry?.(error, attempt);

      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
