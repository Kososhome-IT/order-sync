import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import {
  SYSTEM,
  DIRECTION,
  EVENT_TYPE,
  STATUS,
} from "../constants/orderSync";

/* -------------------------
   JSON response helper
-------------------------- */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request }) {
  const SHOP_DOMAIN = process.env.SHOP;
  const API_VERSION = "2025-04";

  /* 1 Allow POST only */
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  /* 2 Parse payload */
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  console.log("📥 NETSUITE PAYLOAD:", JSON.stringify(payload, null, 2));

  /* 3 Validate payload */
  if (!payload.orderId) {
    return jsonResponse({ error: "orderId is required" }, 400);
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return jsonResponse(
      { error: "At least one line item is required" },
      400
    );
  }

  /* 4 Idempotency */
  const existing = await prisma.orderSync.findUnique({
    where: { netsuiteOrderId: payload.orderId },
  });

  if (existing) {
    return jsonResponse({ message: "Order already processed" }, 200);
  }

  /* 5 Load OFFLINE session */
  const session = await sessionStorage.loadSession(
    `offline_${SHOP_DOMAIN}`
  );

  if (!session) {
    return jsonResponse(
      { error: "Offline Shopify session not found" },
      401
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
        customerId: payload.customer.id,
        companyLocationId:payload.companyLocationId,
        sourceName: "NetSuite",
        financialStatus:
          payload.paymentStatus === "PAID"
            ? "PAID"
            : "PENDING",
        lineItems: payload.items.map((item) => ({
          variantId: item.variantId, // REQUIRED
          quantity: item.quantity,
        })),
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
