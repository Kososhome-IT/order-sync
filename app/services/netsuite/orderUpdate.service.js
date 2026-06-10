import { netsuite } from "./netsuite.server";
import prisma from "../../db.server";
import { findItemBySku, } from "./inventory.service";


async function getExistingLines(
  netsuiteOrderId
) {

  const sublist =
    await netsuite.getOrderItems(
      netsuiteOrderId
    );

  const lines = [];

  for (const row of sublist.data.items) {

    const href =
      row.links[0].href;

    const lineId =
      href.split("/").pop();

    const line =
      await netsuite.getOrderItem(
        netsuiteOrderId,
        lineId
      );

    lines.push(line.data);
  }

  return lines;
}

export async function processShopifyOrderUpdate(
  orderSyncId
) {
console.log(
  "PROCESSING ORDER UPDATE",
  orderSyncId
);
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

if (!sync.netsuiteOrderId) {
  throw new Error(
    `NetSuite Order ID missing for OrderSync ${orderSyncId}`
  );
}
// featching line items in netsuite 
const existingLines =
  await getExistingLines(
    sync.netsuiteOrderId
  );

// console.log(
//   JSON.stringify(
//     existingLines,
//     null,
//     2
//   )
// );

const existingLineMap = {};

for (const line of existingLines) {

  existingLineMap[
    line.item.id
  ] = line.line;
}

const updateLog = await prisma.orderSyncLog.findFirst({
  where: {
    orderSyncId,
    eventType: "UPDATE",
  },
  orderBy: {
    createdAt: "desc",
  },
});

const shopifyOrder = updateLog.rawPayload;

const nsLines = [];

// checking order in netsuite
// end hered

for (const lineItem of shopifyOrder.line_items) {

  const nsItem = await findItemBySku(
    lineItem.sku
  );

 nsLines.push({
  line: existingLineMap[
    nsItem.id
  ],

  item: {
    id: nsItem.id,
  },

  quantity:
    lineItem.quantity,
});
}

const payload = {
  item: {
    items: nsLines,
  },
};

// console.log(
//   JSON.stringify(
//     nsLines,
//     null,
//     2
//   )
// );

console.log(
  "UPDATE PAYLOAD",
  JSON.stringify(payload, null, 2)
);
const result = await netsuite.updateOrder(
  sync.netsuiteOrderId,
  payload
);

console.log(
  "NETSUITE UPDATE RESULT",
  JSON.stringify(result, null, 2)
);

}