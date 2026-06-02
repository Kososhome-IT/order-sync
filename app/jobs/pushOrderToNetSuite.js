import prisma from "../db.server";

export async function pushOrderToNetSuite(orderSync) {
  try {
    // 1. Fetch Shopify order (Admin API)
    // 2. Resolve customer
    // 3. Map SKUs
    // 4. Create NetSuite Sales Order

    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        status: "SUCCESS",
        netsuiteOrderId: "NS-10001",
      },
    });
  } catch (err) {
    await prisma.orderSync.update({
      where: { id: orderSync.id },
      data: {
        status: "FAILED",
        errorMessage: err.message,
        retryCount: { increment: 1 },
      },
    });
  }
}
