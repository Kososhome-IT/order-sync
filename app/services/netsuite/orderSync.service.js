import prisma from "../../db.server";
import { netsuite } from "./netsuite.server";
import { findCompanyByShopifyId } from "./company.service";
import { findItemBySku, } from "./inventory.service";
import { unauthenticated } from "../../shopify.server";
import { NETSUITE_CONFIG } from "../../constants/integrationConfig";

const { salesOrder: NETSUITE_SALES_ORDER } = NETSUITE_CONFIG;

const US_STATE_CODES = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

function getUSStateCode(state) {
  if (!state) return null;

  const normalizedState = state.trim();

  // Already a 2-letter state code
  if (/^[A-Za-z]{2}$/.test(normalizedState)) {
    return normalizedState.toUpperCase();
  }

  const entry = Object.entries(US_STATE_CODES).find(
    ([name]) =>
      name.toLowerCase() === normalizedState.toLowerCase()
  );

  return entry ? entry[1] : normalizedState;
}


async function getPickupAddressFromMetafields(admin, shopifyOrderId,shopifyOrder) {
  const response = await admin.graphql(
    `#graphql
      query GetPickupAddressMetafields($id: ID!) {
        order(id: $id) {

          finalDestinationCountry: metafield(
            namespace: "custom"
            key: "final_destination_country"
          ) {
            value
          }

          finalDestinationPostalCode: metafield(
            namespace: "custom"
            key: "final_destination_postal_code"
          ) {
            value
          }

          finalDestinationState: metafield(
            namespace: "custom"
            key: "final_destination_state"
          ) {
            value
          }

          finalDestinationCity: metafield(
            namespace: "custom"
            key: "final_destination_city"
          ) {
            value
          }

          finalDestinationAddress2: metafield(
            namespace: "custom"
            key: "final_destination_address2"
          ) {
            value
          }

          finalDestinationAddress1: metafield(
            namespace: "custom"
            key: "final_destination_address1"
          ) {
            value
          }

          finalDestinationPhone: metafield(
            namespace: "custom"
            key: "final_destination_phone"
          ) {
            value
          }

          finalDestinationAttention: metafield(
            namespace: "custom"
            key: "final_destination_attention"
          ) {
            value
          }

          finalDestinationAddressee: metafield(
            namespace: "custom"
            key: "final_destination_addressee"
          ) {
            value
          }
        }
      }
    `,
    {
      variables: {
        id: `gid://shopify/Order/${shopifyOrderId}`,
      },
    }
  );

  const result = await response.json();

  if (result.errors) {
    throw new Error(
      `Failed to fetch pickup address metafields: ${JSON.stringify(
        result.errors
      )}`
    );
  }

  const order = result.data?.order;

  if (!order) {
    throw new Error(
      `Shopify order not found: ${shopifyOrderId}`
    );
  }
const metafieldValues = [
  order.finalDestinationCountry?.value,
  order.finalDestinationPostalCode?.value,
  order.finalDestinationState?.value,
  order.finalDestinationCity?.value,
  order.finalDestinationAddress2?.value,
  order.finalDestinationAddress1?.value,
  order.finalDestinationPhone?.value,
  order.finalDestinationAttention?.value,
  order.finalDestinationAddressee?.value,
];

const hasMetafieldValue = metafieldValues.some(
  (value) =>
    value !== null &&
    value !== undefined &&
    value.trim() !== ""
);

if (!hasMetafieldValue) {
  return null;
}
  const state = getUSStateCode(
    order.finalDestinationState?.value
  );

  return {
    ...(order.finalDestinationAddressee?.value
      ? {
          addressee:
            order.finalDestinationAddressee.value,
        }
      : {}),

    ...(order.finalDestinationAttention?.value
      ? {
          attention:
            order.finalDestinationAttention.value,
        }
      : {}),

    ...(order.finalDestinationAddress1?.value
      ? {
          addr1:
            order.finalDestinationAddress1.value,
        }
      : {}),

    ...(order.finalDestinationAddress2?.value
      ? {
          addr2:
            order.finalDestinationAddress2.value,
        }
      : {}),

    ...(order.finalDestinationCity?.value
      ? {
          city:
            order.finalDestinationCity.value,
        }
      : {}),

    ...(state
      ? {
          state,
        }
      : {}),

    ...(order.finalDestinationPostalCode?.value
      ? {
          zip:
            order.finalDestinationPostalCode.value,
        }
      : {}),

    // Country is always United States
    country: {
      id: "US",
    },

    ...(order.finalDestinationPhone?.value
      ? {
          addrPhone:
            order.finalDestinationPhone.value,
        }
      : {}),

    isResidential:
      NETSUITE_SALES_ORDER.customShippingAddress
        .isResidential,
  };
}

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
  // const admin = await getAdminClient(process.env.SHOP);
  
  try {
    const { admin } = await unauthenticated.admin(process.env.SHOP);
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
const isPickupOrder = shopifyOrder.shipping_lines?.some(
  (shippingLine) =>
    shippingLine.code === "High Point, NC" ||
    shippingLine.code === "Los Angeles, CA"
);

let shippingAddress = buildShopifyShippingAddress(
  shopifyOrder.shipping_address
);

if (isPickupOrder) {
  const pickupAddress = await getPickupAddressFromMetafields(
    admin,
    shopifyOrder.id
  );

  if (pickupAddress) {
    shippingAddress = pickupAddress;
  }
}
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
  // Get Side Mark from Shopify line-item properties
  const sidemarkProperty = lineItem.properties?.find(
    (property) =>
      property.name?.toLowerCase() === "side mark"
  );

  const sidemark = sidemarkProperty?.value ?? "";
    nsLines.push({
      item: {
        id: nsItem.id,
      },
      quantity,
     // NetSuite Item Line field: Side Marks
    custcol_sps_gen_noteinformationfield: sidemark,
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

// console.log(
//   "COMPANY MAPPING",
//   company
// );  

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


const order_notes = shopifyOrder.note
  const otherRefNumDummy = shopifyOrder.name?.replace("#", "")

  payload = {
    customForm: { id: NETSUITE_DEFAULTS.customFormId, },
    custbody_ch_so_order_notes: order_notes,
    entity: { id: company.netsuiteCompanyId },
    subsidiary: { id:  NETSUITE_DEFAULTS.subsidiaryId, },
    otherRefNum: shopifyOrder.po_number || shopifyOrder.name, 
    [NETSUITE_SALES_ORDER.fields.webOrderNumber]:otherRefNumDummy,
    [NETSUITE_SALES_ORDER.fields.orderType]:{id:NETSUITE_DEFAULTS.custbody_wmsse_ordertype},
    // [NETSUITE_SALES_ORDER.fields.accountSpec]: { id: NETSUITE_DEFAULTS.accountSpecId },
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

  // console.log("Creating NetSuite Sales Order",JSON.stringify(payload, null, 2));
  const result = await netsuite.createOrder(payload);
//   console.log(
//   "ORDER CREATED RESPONSE",
//   JSON.stringify(result, null, 2)
// );
//   console.log(
//   "NETSUITE CREATE RESPONSE",
//   JSON.stringify(result, null, 2)
// );
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
  // console.log("Sales Order Result:", result);

  // console.log("NetSuite Response:", result);
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
