import prisma from "../db.server";

export const paymentRepository = {
  /**
   * Create a successful payment synchronization checkpoint entry.
   */
  async createPaymentSync({ netsuiteOrderId, shopifyOrderId, authorizationId, paymentReference, capturedAmount, status }) {
    return prisma.paymentSync.create({
      data: {
        netsuiteOrderId: netsuiteOrderId.toString(),
        shopifyOrderId: shopifyOrderId.toString(),
        authorizationId,
        paymentReference,
        capturedAmount,
        status,
      },
    });
  }
};