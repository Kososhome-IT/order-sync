import prisma from "../../db.server";
import { netsuite } from "./netsuite.server";
import { findCompanyByShopifyId } from "./company.service";
import { findItemBySku, } from "./inventory.service";
import { sessionStorage } from "../../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { NETSUITE_CONFIG, SHOPIFY_CONFIG } from "../../constants/integrationConfig";

const { salesOrder: NETSUITE_SALES_ORDER } = NETSUITE_CONFIG;

function buildShopifyShippingAddress(shopifyAddress) {
  if (!shopifyAddress) {
    return null;
  }

  const firstName = shopifyAddress.first_name || "";
  const lastName = shopifyAddress.last_name || "";
  const addressee =
    shopifyAddress.name ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    shopifyAddress.company;

  return {
    ...(addressee ? { addressee } : {}),
    ...(shopifyAddress.company ? { attention: shopifyAddress.company } : {}),
    ...(shopifyAddress.address1 ? { addr1: shopifyAddress.address1 } : {}),
    ...(shopifyAddress.address2 ? { addr2: shopifyAddress.address2 } : {}),
    ...(shopifyAddress.city ? { city: shopifyAddress.city } : {}),
    ...(shopifyAddress.province_code || shopifyAddress.province
      ? { state: shopifyAddress.province_code || shopifyAddress.province }
      : {}),
    ...(shopifyAddress.zip ? { zip: shopifyAddress.zip } : {}),
    ...(shopifyAddress.country_code
      ? { country: { id: shopifyAddress.country_code } }
      : {}),
    ...(shopifyAddress.phone ? { addrPhone: shopifyAddress.phone } : {}),
    isResidential: NETSUITE_SALES_ORDER.customShippingAddress.isResidential,
  };
}

export async function processShopifyOrder(orderSyncId, options = {}) {
    let payload = null;
    const SHOP_DOMAIN = process.env.SHOP;
  const API_VERSION = SHOPIFY_CONFIG.apiVersions.adminGraphql;
  
  const session = await sessionStorage.loadSession(`offline_${SHOP_DOMAIN}`);
  if (!session) {
  throw new Error(
    "Offline Shopify session not found"
  );
}
  const admin = createAdminApiClient({
    storeDomain: SHOP_DOMAIN,
    apiVersion: API_VERSION,
    accessToken: session.accessToken,
  });

  try {
  const sync = await prisma.orderSync.findUnique({
    where: {
      id: orderSyncId,
    },
  });
  const NETSUITE_DEFAULTS = {
  customFormId: NETSUITE_SALES_ORDER.customFormId,
  subsidiaryId: NETSUITE_SALES_ORDER.subsidiaryId,
  accountSpecId: NETSUITE_SALES_ORDER.accountSpecId,
  orderSourceId: NETSUITE_SALES_ORDER.orderSourceId,
  orderAttributeId: NETSUITE_SALES_ORDER.orderAttributeId,
  segmentId: NETSUITE_SALES_ORDER.segmentId,
  custbody_wmsse_ordertype: NETSUITE_SALES_ORDER.orderTypeIds.readyToCharge
};


  if (!sync) {
    throw new Error(
      `OrderSync not found: ${orderSyncId}`
    );
  }
  // Use fresh Shopify payload when retrying, otherwise use the original webhook payload.
  const shopifyOrder = options.shopifyOrder || sync.webhookPayload;


if (!shopifyOrder) {
  throw new Error(
    `Shopify order payload missing for orderSyncId ${orderSyncId}`
  );
}
const shippingAddress = buildShopifyShippingAddress(shopifyOrder.shipping_address);
  //  creating netsuite line from shopify order line items 
  const nsLines = [];

  for (const lineItem of shopifyOrder.line_items) {
    const quantity = Number(lineItem.current_quantity ?? lineItem.quantity ?? 0);

    if (quantity <= 0) {
      continue;
    }

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
      quantity,
      rate: Number(lineItem.price),
    });
  }

  // Temporary test call

console.log(
  "[COMPANY DEBUG] Shopify order company:",
  JSON.stringify(shopifyOrder.company, null, 2)
);

  const company = await findCompanyByShopifyId(
    admin,
    shopifyOrder.company.id
  );

console.log(
  "COMPANY MAPPING",
  company
);  

const shippingAmount =
  Number(
    shopifyOrder
      ?.total_shipping_price_set
      ?.shop_money
      ?.amount || 0
  );


let shippingMethod = null;

if (
  shopifyOrder.shipping_lines?.some(
    (shippingLine) => shippingLine.code === 'CLASSIC_HOME_FREIGHT'
  )
) {
  shippingMethod = {
    id: NETSUITE_SALES_ORDER.shippingMethodId_2,
  };
} 

if (
  shopifyOrder.shipping_lines?.some(
    (shippingLine) => shippingLine.code === 'CLASSIC_HOME_FEDEX_GROUND'
  )
) {
  shippingMethod = {
    id: NETSUITE_SALES_ORDER.shippingMethodId_1,
  };
}
// pickup ncbc
if (
  shopifyOrder.shipping_lines?.some(
    (shippingLine) => shippingLine.code === 'High Point, NC'
  )
) {
  shippingMethod = {
    id: NETSUITE_SALES_ORDER.order_customer_pick,
  };
}
// pickup vemw
if (
  shopifyOrder.shipping_lines?.some(
    (shippingLine) => shippingLine.code === 'Los Angeles, CA'
  )
) {
  shippingMethod = {
    id: NETSUITE_SALES_ORDER.order_customer_pick,
  };
}



  const otherRefNumDummy = shopifyOrder.name?.replace("#", "")

  payload = {
    customForm: { id: NETSUITE_DEFAULTS.customFormId, },
    entity: { id: company.netsuiteCompanyId },
    subsidiary: { id:  NETSUITE_DEFAULTS.subsidiaryId, },
    otherRefNum: shopifyOrder.po_number || shopifyOrder.name, 
    [NETSUITE_SALES_ORDER.fields.webOrderNumber]:otherRefNumDummy,
    [NETSUITE_SALES_ORDER.fields.orderType]:{id:NETSUITE_DEFAULTS.custbody_wmsse_ordertype},
    [NETSUITE_SALES_ORDER.fields.accountSpec]: { id: NETSUITE_DEFAULTS.accountSpecId },
    shippingcost:shippingAmount,
    shipmethod:shippingMethod,
    [NETSUITE_SALES_ORDER.fields.orderSource]: { id: NETSUITE_DEFAULTS.orderSourceId },
    [NETSUITE_SALES_ORDER.fields.orderAttribute]: {
      items: [{ id: NETSUITE_DEFAULTS.orderAttributeId }],
    },
    [NETSUITE_SALES_ORDER.fields.businessUnit]: { id: NETSUITE_DEFAULTS.segmentId },
    shipAddressList: { id: NETSUITE_SALES_ORDER.customShippingAddress.shipAddressListId },
    shippingAddress,
    item: {
      items: nsLines,
    }
  };

  console.log("Creating NetSuite Sales Order",JSON.stringify(payload, null, 2));
  const result = await netsuite.createOrder(payload);
  console.log(
  "ORDER CREATED RESPONSE",
  JSON.stringify(result, null, 2)
);
  console.log(
  "NETSUITE CREATE RESPONSE",
  JSON.stringify(result, null, 2)
);
if (!result.success) {
  throw new Error(
    result.data?.["o:errorDetails"]
      ?.map(e => e.detail)
      ?.join(", ") ||
    "NetSuite order creation failed"
  );
}

const netsuiteOrderId = result.location?.split("/").pop();

if (!netsuiteOrderId) {
  throw new Error(
    "Failed to extract NetSuite Order ID"
  );
}
  console.log("Sales Order Result:", result);

  console.log("NetSuite Response:", result);
  await prisma.orderSyncLog.create({
  data: {
    orderSyncId,
    sourceSystem: "NETSUITE",
    direction: "SHOPIFY_TO_NETSUITE",

    eventType: "CREATE",
    status: "SUCCESS",

    message: "NetSuite Sales Order created",

    requestPayload: payload,
    responsePayload: {
      ...result,
      
    },
  },
});
await prisma.orderSync.update({
  where: {
    id: orderSyncId,
  },
  data: {
    status: "SUCCESS",
    action: "CREATE",
    errorMessage: null,
  },
});

await prisma.orderSync.update({
  where: {
    id: orderSyncId,
  },
  data: {
    netsuiteCompanyId:company.netsuiteCompanyId,
    netsuiteOrderId,
    status: "SUCCESS",
    action: "CREATE",
    errorMessage: null,
  },
});
return netsuiteOrderId;
  } catch (error) {
        await prisma.orderSyncLog.create({
      data: {
        orderSyncId,

        sourceSystem: "NETSUITE",
        direction: "SHOPIFY_TO_NETSUITE",

        eventType: "CREATE",
        status: "FAILED",

        message: error.message,

        requestPayload: payload,

        errorPayload: {
          message: error.message,
          stack: error.stack,
        },
      },
    });

        await prisma.orderSync.update({
      where: {
        id: orderSyncId,
      },
      data: {
        status: "FAILED",
        action: "CREATE",
        errorMessage: error.message,
      },
    });

        throw error;
  }
}
