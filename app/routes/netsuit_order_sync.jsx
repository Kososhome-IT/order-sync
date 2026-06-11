import prisma from "../db.server";
import { jsonResponse } from "../utils/jsonResponse";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getVariantIdBySKU } from "../services/shopify/product.service"
import { findCompanyByNetSuiteId } from "../services/shopify/company.service"
import { findCustomerByEmail } from "../services/shopify/customer.service"
import { SYSTEM, DIRECTION, EVENT_TYPE, STATUS, } from "../constants/orderSync";



export async function action({ request }) {
  const SHOP_DOMAIN = process.env.SHOP;
  const API_VERSION = "2025-07";
  let payload;
  const lineItems = [];
  const validationErrors = [];
  
  console.log("SHOP_DOMAIN:", SHOP_DOMAIN);
  /* 1 Allow POST only */
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  /* 2 Parse payload */
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

const session = await sessionStorage.loadSession(`offline_${SHOP_DOMAIN}`);
 const existing = await prisma.orderSync.findUnique({
    where: { netsuiteOrderId: payload.orderId },
  });
  // console.log("📥 NETSUITE PAYLOAD:", JSON.stringify(payload, null, 2));


// validations

if (!payload.orderId) {
  validationErrors.push("orderId is required");
}

if (!payload.customer?.email) {
  validationErrors.push("customer.email is required");
}

if (!payload.companyLocationId) {
  validationErrors.push("companyLocationId is required");
}

if (!Array.isArray(payload.items) || payload.items.length === 0) {
  validationErrors.push(
    "At least one line item is required"
  );
}
  if (existing) {
    validationErrors.push("Order already processed" );
  }

   if (!session) {
    validationErrors.push("Offline Shopify session not found" );
  } 
if (validationErrors.length) {
  return jsonResponse(
    {
      error: "Validation failed",
      details: validationErrors,
    },
    400
  );
}



  
 console.log("🔐 OFFLINE SESSION:", {
    shop: session.shop,
    scope: session.scope,
    isOnline: session.isOnline,
  });

  /* 6 Admin API client */
  const admin = createAdminApiClient({
    storeDomain: SHOP_DOMAIN,
    apiVersion: API_VERSION,
    accessToken: session.accessToken,
  });
  //  preaparing lineitems from payload
  
const customer = await findCustomerByEmail(admin,payload.customer.email);
// const company = await findCompanyByNetSuiteId(admin,payload.companyLocationId);
// const companyLocationId = company.locations.nodes[0]?.id;
const company =
  await findCompanyByNetSuiteId(
    admin,
    payload.companyLocationId
  );

const companyLocationId =
  company.companyLocationId;


console.log("customer",customer)
console.log("company",company)
console.log("companyLocationId",companyLocationId)

  for (const item of payload.items) {
    if (!item.sku) {
      return jsonResponse(
        { error: "SKU is required for all line items" },
        400
      );
    }

    try {
      const variantId = await getVariantIdBySKU(admin, item.sku);

      lineItems.push({
        variantId,
        quantity: item.quantity,
      });
    } catch (error) {
      return jsonResponse(
        { error: error.message },
        400
      );
    }
  }
  /* 7 CREATE ORDER */
  const orderMutation = `
    mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order {
      id
      name
      createdAt
      customer {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}

  `;

  const orderRes = await admin.request(orderMutation, {
    variables: {
      order: {
        customerId: customer.id,
        companyLocationId,
        sourceName: "NetSuite",
        name: payload.orderId,
        financialStatus:
          payload.paymentStatus === "PAID"
            ? "PAID"
            : "PENDING",
        lineItems
      },
    },
  });

  console.log(
    "🧾 ORDER CREATE RESPONSE:",
    JSON.stringify(orderRes, null, 2)
  );

  const orderCreate = orderRes?.data?.orderCreate;

  if (!orderCreate) {
    return jsonResponse(
      { error: "Shopify returned no orderCreate data" },
      400
    );
  }

  if (orderCreate.userErrors.length) {
    return jsonResponse(
      { error: orderCreate.userErrors[0].message },
      400
    );
  }

  /* 🔟 Save mapping */
  await prisma.orderSync.create({
    data: {
      netsuiteOrderId: payload.orderId,
      netsuiteCompanyId: payload.companyLocationId,
      originSystem: SYSTEM.NETSUITE,
      lastSyncedFrom: SYSTEM.NETSUITE,
      status: STATUS.SUCCESS,
    },
  });

  console.log("✅ ORDER CREATED:", orderCreate);

  return jsonResponse({
    success: true,
    // shopifyOrderId: orderCreate.order.id,
  });
}
