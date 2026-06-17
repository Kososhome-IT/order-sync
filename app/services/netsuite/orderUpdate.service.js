import { netsuite } from "./netsuite.server";
import prisma from "../../db.server";
import { findItemBySku } from "./inventory.service";
import { SYSTEM, DIRECTION, EVENT_TYPE, STATUS } from "../../constants/orderSync";

/**
 * Fetches existing line items for a specific order from NetSuite.
 */
async function getExistingLines(netsuiteOrderId) {
  const sublist = await netsuite.getOrderItems(netsuiteOrderId);
  const lines = [];

  for (const row of sublist.data.items) {
    const href = row.links[0].href;
    const lineId = href.split("/").pop();

    const line = await netsuite.getOrderItem(netsuiteOrderId, lineId);
    lines.push(line.data);
  }

  return lines;
}

/**
 * Processes the Shopify order update and syncs it with NetSuite.
 */
export async function processShopifyOrderUpdate(orderSyncId) {
  try {
    console.log("PROCESSING ORDER UPDATE", orderSyncId);

    // Fetch the sync record from the database
    const sync = await prisma.orderSync.findUnique({
      where: { id: orderSyncId },
    });

    if (!sync) {
      throw new Error(`OrderSync not found: ${orderSyncId}`);
    }

    if (!sync.netsuiteOrderId) {
      throw new Error(`NetSuite Order ID missing for OrderSync ${orderSyncId}`);
    }

    // Fetch current line items from NetSuite
    const existingLines = await getExistingLines(sync.netsuiteOrderId);
    const existingLineMap = {};

    // Map NetSuite item IDs to their corresponding line IDs
    for (const line of existingLines) {
      existingLineMap[line.item.id] = line.line;
    }

    // Retrieve the latest Shopify update payload from logs
    const updateLog = await prisma.orderSyncLog.findFirst({
      where: {
        orderSyncId,
        eventType: "UPDATE",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log("UPDATE LOG ID", updateLog?.id);
    const shopifyOrder = updateLog.rawPayload;
    const nsLines = [];

    // Map Shopify line items to NetSuite lines using SKU
    for (const lineItem of shopifyOrder.line_items) {
      const nsItem = await findItemBySku(lineItem.sku);

      if (!nsItem) {
        throw new Error(`NetSuite item not found for SKU ${lineItem.sku}`);
      }

      if (!existingLineMap[nsItem.id]) {
        throw new Error(`Line not found on NetSuite order for item ${nsItem.id}`);
      }

      nsLines.push({
        line: existingLineMap[nsItem.id],
        item: { id: nsItem.id },
        quantity: lineItem.quantity,
      });
    }

    const payload = {
      item: { items: nsLines },
    };

    console.log("NS LINES:", JSON.stringify(nsLines, null, 2));
    console.log("UPDATE PAYLOAD:", JSON.stringify(payload, null, 2));

    // Send the updated payload to NetSuite
    const result = await netsuite.updateOrder(sync.netsuiteOrderId, payload);

    // Log the successful synchronization
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.SHOPIFY_TO_NETSUITE,
        eventType: EVENT_TYPE.UPDATE,
        status: STATUS.SUCCESS,
        responsePayload: result,
      },
    });

    console.log("NETSUITE UPDATE RESULT", JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("UPDATE FAILED", error);

    // Log the failure details in the database
    await prisma.orderSyncLog.create({
      data: {
        orderSyncId,
        sourceSystem: SYSTEM.NETSUITE,
        direction: DIRECTION.SHOPIFY_TO_NETSUITE,
        eventType: EVENT_TYPE.UPDATE,
        status: STATUS.FAILED,
        message: error.message,
      },
    });

    throw error;
  }
}