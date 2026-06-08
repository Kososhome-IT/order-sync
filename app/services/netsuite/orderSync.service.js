import prisma from "../../db.server";
import { netsuite } from "./netsuite.server";
import { findCustomerByEmail, } from "./customer.service";
import { findItemBySku, } from "./inventory.service";
import { STATUS } from "../../constants/orderSync";
 
 
export async function processShopifyOrder(orderSyncId) {
  const sync = await prisma.orderSync.findUnique({
    where: {
      id: orderSyncId,
    },
  });
  const NETSUITE_DEFAULTS = {
  customFormId: "216",
  subsidiaryId: "2",
  accountSpecId: "562637",
  orderSourceId: "8",
  orderAttributeId: "54",
  segmentId: "3",
  wmsOrderTypeNewId: process.env.NETSUITE_WMS_ORDER_TYPE_NEW_ID,
};
 
  if (!sync) {
    throw new Error(
      `OrderSync not found: ${orderSyncId}`
    );
  }
 
  if (sync.status === STATUS.SUCCESS || sync.netsuiteOrderId) {
    return {
      success: true,
      skipped: true,
      netsuiteOrderId: sync.netsuiteOrderId,
    };
  }
 
  //  featching raw payload of order from  databse
  const log = await prisma.orderSyncLog.findFirst({
    where: {
      orderSyncId,
      eventType: "CREATE",
    },
    orderBy: {
      createdAt: "desc",
    },
  });
 
  const shopifyOrder = log.rawPayload;
 
  //  creating netsuite line from shopify order line items
  const nsLines = [];
 
  for (const lineItem of shopifyOrder.line_items) {
 
    const nsItem = await findItemBySku(lineItem.sku); // featching inventory record using sku
 
    if (!nsItem) {
      throw new Error(
        `Item not found: ${lineItem.sku}`
      );
    }
 
    nsLines.push({
      item: {
        id: nsItem.id,
      },
      quantity: lineItem.quantity,
      rate: Number(lineItem.price),
    });
  }
 
  // Temporary test call
 
 
  const customerEmail =
    shopifyOrder.customer?.email;
 
  const customer = await findCustomerByEmail(customerEmail);
 
  if (!customer) {
    throw new Error(
      `Customer not found in NetSuite: ${customerEmail}`
    );
  }
 
  const shopifyOrderNumber = shopifyOrder.name || String(shopifyOrder.order_number || "");
  const shopifyPoNumber = getShopifyPoNumber(shopifyOrder);
 
  if (!NETSUITE_DEFAULTS.wmsOrderTypeNewId) {
    throw new Error("NETSUITE_WMS_ORDER_TYPE_NEW_ID is required");
  }
 
  const payload = {
    customForm: { id: NETSUITE_DEFAULTS.customFormId, },
    entity: { id: customer.id },
    subsidiary: { id:  NETSUITE_DEFAULTS.subsidiaryId, },
    ...(shopifyPoNumber ? { otherRefNum: shopifyPoNumber } : {}),
    custbody_ch_om_web_order_number: shopifyOrderNumber,
    custbody_ch_so_acc_spec: { id: "562637" },
    custbody_ch_om_ordersource: { id: NETSUITE_DEFAULTS.orderSourceId },
    custbody_ch_ord_attribute: {
      items: [{ id: "54" }],
    },
    cseg1: { id: NETSUITE_DEFAULTS.segmentId },
    custbody_wmsse_ordertype: {
      id: NETSUITE_DEFAULTS.wmsOrderTypeNewId,
    },
    item: {
      items: nsLines,
    }
  };
 
  console.log(
    "Creating NetSuite Sales Order",
    JSON.stringify(payload, null, 2)
  );
  const result = await netsuite.createOrder(payload);
 
  if (!result.success) {
    await prisma.orderSync.update({
      where: { id: orderSyncId },
      data: {
        status: STATUS.FAILED,
        errorMessage: JSON.stringify(result.data || result),
      },
    });
 
    throw new Error("NetSuite sales order creation failed");
  }
 
  const netsuiteOrderId = getNetSuiteOrderId(result);
 
  await prisma.orderSync.update({
    where: { id: orderSyncId },
    data: {
      status: STATUS.SUCCESS,
      netsuiteOrderId,
      errorMessage: null,
    },
  });
 
  console.log("Sales Order Result:", result);
 
  console.log(
    "NetSuite Response:",
    result
  );
 
  return result;
}
 
function getNetSuiteOrderId(result) {
  if (result.internalId) return String(result.internalId);
  if (result.data?.id) return String(result.data.id);
  if (result.data?.internalId) return String(result.data.internalId);
 
  const location = result.location || "";
  const idFromLocation = location.match(/\/salesOrder\/([^/?#]+)/i)?.[1];
 
  return idFromLocation ? decodeURIComponent(idFromLocation) : null;
}
 
function getShopifyPoNumber(order) {
  const directPoNumber =
    order.po_number ||
    order.poNumber ||
    order.purchase_order_number ||
    order.purchaseOrderNumber;
 
  if (directPoNumber) {
    return String(directPoNumber);
  }
 
  const poAttribute = order.note_attributes?.find((attribute) => {
    const name = String(attribute.name || "").toLowerCase();
 
    return [
      "po number",
      "po_number",
      "purchase order",
      "purchase order number",
    ].includes(name);
  });
 
  return poAttribute?.value ? String(poAttribute.value) : null;
}