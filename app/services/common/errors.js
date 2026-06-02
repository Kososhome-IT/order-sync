export class AppError extends Error {
  constructor(message, code, statusCode = 500, isOperational = true) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NetSuiteError extends AppError {
  constructor(message, netsuiteCode, statusCode = 500) {
    super(message, "NETSUITE_ERROR", statusCode);
    this.name = "NetSuiteError";
    this.netsuiteCode = netsuiteCode;
  }
}

export class NetSuiteAuthError extends NetSuiteError {
  constructor(message) {
    super(message, "AUTH_FAILED", 401);
    this.name = "NetSuiteAuthError";
  }
}

export class NetSuiteRateLimitError extends NetSuiteError {
  constructor(retryAfter) {
    super(`NetSuite rate limit exceeded. Retry after ${retryAfter}s`, "RATE_LIMIT", 429);
    this.name = "NetSuiteRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ShopifyError extends AppError {
  constructor(
    message,
    userErrors,
    statusCode = 500,
  ) {
    super(message, "SHOPIFY_ERROR", statusCode);
    this.name = "ShopifyError";
    this.userErrors = userErrors;
  }
}

export class ShopifyRateLimitError extends ShopifyError {
  constructor(availablePoints, restoreRate) {
    super(`Shopify rate limit: ${availablePoints} points remaining`, undefined, 429);
    this.name = "ShopifyRateLimitError";
    this.availablePoints = availablePoints;
    this.restoreRate = restoreRate;
  }
}

export class SyncError extends AppError {
  constructor(message, entityType, recordId) {
    super(message, "SYNC_ERROR", 500);
    this.name = "SyncError";
    this.entityType = entityType;
    this.recordId = recordId;
  }
}

export class ConflictError extends SyncError {
  constructor(entityType, recordId) {
    super(
      `Conflict detected for ${entityType} record ${recordId}`,
      entityType,
      recordId,
    );
    this.name = "ConflictError";
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
    this.details = details;
  }
}

export function isRetryableError(error) {
  if (error instanceof NetSuiteRateLimitError) return true;
  if (error instanceof ShopifyRateLimitError) return true;
  if (error instanceof AppError) {
    return error.statusCode >= 500 || error.statusCode === 429;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("socket hang up")
    );
  }
  return false;
}
