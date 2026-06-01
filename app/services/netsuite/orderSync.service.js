import prisma from "../../db.server";
import { netsuite } from "./netsuite.server";


export async function processShopifyOrder(orderSyncId) {
  const sync = await prisma.orderSync.findUnique({
    where: {
      id: orderSyncId,
    },
  });

  if (!sync) {
    throw new Error(
      `OrderSync not found: ${orderSyncId}`
    );
  }

  // Temporary test call
  const otherRefNumDummy = String(
  Math.floor(10000000 + Math.random() * 90000000)
);
 const payload = {
  customForm: { id: "216" },
  entity: { id: "1198517" },
  subsidiary: { id: "2" },
  terms: { id: "2" },
  otherRefNum: otherRefNumDummy,
  custbody_ch_so_acc_spec: { id: "562637" },
  custbody_ch_om_ordersource: { id: "8" },
  custbody_ch_ord_attribute: {
    items: [{ id: "54" }],
  },
  cseg1: { id: "3" },
  item: {
    items: [
      {
        item: { id: "358" },
        quantity: 1,
        rate: 5,
      },
    ],
  },
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