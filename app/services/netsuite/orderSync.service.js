import prisma from "../../db.server";
import { netsuite } from "./netsuite.server";
import { findCustomerByEmail, } from "./customer.service";
import { findItemBySku, } from "./inventory.service";


export async function processShopifyOrder(orderSyncId) {
  const sync = await prisma.orderSync.findUnique({
    where: {
      id: orderSyncId,
    },
  });
  const NETSUITE_DEFAULTS = {
  customFormId: "216",
  subsidiaryId: "2",
  termsId: "2",
  accountSpecId: "562637",
  orderSourceId: "8",
  orderAttributeId: "54",
  segmentId: "3",
};

  if (!sync) {
    throw new Error(
      `OrderSync not found: ${orderSyncId}`
    );
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

  const otherRefNumDummy = shopifyOrder.name?.replace("#", "")

  const payload = {
    customForm: { id: NETSUITE_DEFAULTS.customFormId, },
    entity: { id: customer.id },
    subsidiary: { id:  NETSUITE_DEFAULTS.subsidiaryId, },
    terms: { id: NETSUITE_DEFAULTS.termsId },
    otherRefNum: otherRefNumDummy,
    custbody_ch_so_acc_spec: { id: "562637" },
    custbody_ch_om_ordersource: { id: NETSUITE_DEFAULTS.orderSourceId },
    custbody_ch_ord_attribute: {
      items: [{ id: "54" }],
    },
    cseg1: { id: NETSUITE_DEFAULTS.segmentId },
    item: {
      items: nsLines,
    }
  };

  console.log(
    "Creating NetSuite Sales Order",
    JSON.stringify(payload, null, 2)
  );
  const result = await netsuite.createOrder(payload);

  console.log("Sales Order Result:", result);

  console.log(
    "NetSuite Response:",
    result
  );
}