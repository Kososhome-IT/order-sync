import { orderRepository } from "../repositories/order.repository";

export const syncLogger = {
  async log({ orderSyncId, eventType = "PAYMENT_CAPTURE", status, message, direction = "NETSUITE_TO_SHOPIFY", sourceSystem = "NETSUITE", requestPayload, responsePayload }) {
    const icon = status === "SUCCESS" ? "✅" : "❌";
    console.log(`[${sourceSystem} -> ${direction}] [${eventType}] [${status}] ${icon} ${message}`);

    try {
      // Calls repository directly instead of raw Prisma client
      return await orderRepository.createLog({
        orderSyncId, sourceSystem, direction, eventType, status, message, requestPayload, responsePayload
      });
    } catch (err) {
      console.error(`[syncLogger Service Error] Repository write failed:`, err.message);
    }
  },

  async success(options) { return this.log({ ...options, status: "SUCCESS" }); },
  async failed(options) { return this.log({ ...options, status: "FAILED" }); }
};