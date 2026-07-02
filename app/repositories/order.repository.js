import prisma from "../db.server";

export const orderRepository = {
  /**
   * Find an active order sync mapping by its Shopify order name.
   */
  async findByName(shopifyOrderName) {
    return prisma.orderSync.findFirst({
      where: { shopifyOrderName },
    });
  },

  /**
   * Update the payment timestamp for a verified order sync.
   */
  async updatePaymentCaptureTime(id) {
    return prisma.orderSync.update({
      where: { id },
      data: { paymentCapturedAt: new Date() },
    });
  },

  /**
   * Write an audit transaction record to the logs.
   */
  async createLog({ orderSyncId, sourceSystem, direction, eventType, status, message, requestPayload, responsePayload }) {
    return prisma.orderSyncLog.create({
      data: {
        orderSyncId,
        sourceSystem,
        direction,
        eventType,
        status,
        message,
        requestPayload: requestPayload || {},
        responsePayload: responsePayload || {},
      },
    });
  }
};