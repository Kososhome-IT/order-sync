import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "SYS:standard",
          },
        },
      }
    : {}),
  base: {
    service: "shopify-netsuite-sync",
    env: process.env.NODE_ENV,
  },
});

export function createSyncLogger(entityType, syncRunId) {
  return logger.child({ entityType, syncRunId });
}

export function createServiceLogger(service) {
  return logger.child({ service });
}

export default logger;
