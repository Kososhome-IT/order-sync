export const SYNC_ENTITY_TYPES = ["inventory", "order", "customer"];

export const SYNC_DIRECTIONS = ["ns_to_shopify", "shopify_to_ns"];

export const SYNC_STATUSES = ["pending", "processing", "success", "failed", "skipped"];

export const QUEUE_NAMES = {
  INVENTORY_SYNC: "inventory-sync",
  ORDER_SYNC: "order-sync",
  CUSTOMER_SYNC: "customer-sync",
  CLEANUP: "cleanup",
};

export const DEFAULT_CRON = {
  INVENTORY: "*/15 * * * *",
  ORDER_POLL: "*/5 * * * *",
  CUSTOMER: "*/30 * * * *",
  CLEANUP: "0 3 * * *",
};

export const RATE_LIMITS = {
  NETSUITE_MAX_CONCURRENT: Number(process.env.NETSUITE_MAX_CONCURRENT) || 10,
  NETSUITE_MAX_PER_SECOND: Number(process.env.NETSUITE_MAX_PER_SECOND) || 10,
  SHOPIFY_COST_THRESHOLD: Number(process.env.SHOPIFY_COST_THRESHOLD) || 200,
};

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: Number(process.env.MAX_RETRY_ATTEMPTS) || 5,
  ERROR_THRESHOLD_PAUSE: Number(process.env.ERROR_THRESHOLD_PAUSE) || 50,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 300000,
  BACKOFF_MULTIPLIER: 4,
};

export const BATCH_SIZES = {
  INVENTORY_SYNC: 50,
  ORDER_SYNC: 10,
  CUSTOMER_SYNC: 25,
  SHOPIFY_GRAPHQL_PAGE: 250,
  NETSUITE_PAGE: 1000,
};

export const NETSUITE_METAFIELD = {
  NAMESPACE: "netsuite",
  INTERNAL_ID_KEY: "internal_id",
  ORDER_ID_KEY: "order_id",
};

export const WEBHOOK_TOPICS = {
  ORDERS_CREATE: "ORDERS_CREATE",
  ORDERS_UPDATED: "ORDERS_UPDATED",
  CUSTOMERS_CREATE: "CUSTOMERS_CREATE",
  CUSTOMERS_UPDATE: "CUSTOMERS_UPDATE",
  APP_UNINSTALLED: "APP_UNINSTALLED",
};
