import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { createAdminApiClient } from "@shopify/admin-api-client";

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
  const SHOP_DOMAIN = "dummy-ranjit.myshopify.com";
  const API_VERSION = "2025-04";

  /* -------------------------
     1. Method check
  -------------------------- */
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  /* -------------------------
     2. Parse payload
  -------------------------- */
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  console.log("📥 NETSUITE PAYLOAD:", JSON.stringify(payload, null, 2));

  /* -------------------------
     3. Validate payload
  -------------------------- */
  if (!payload.orderId) {
    return jsonResponse({ error: "orderId is required" }, 400);
  }

  if (!payload.company?.id) {
    return jsonResponse(
      { error: "Order must belong to a company" },
      400
    );
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return jsonResponse(
      { error: "At least one line item is required" },
      400
    );
  }

  /* -------------------------
     4. Idempotency
  -------------------------- */
  const existing = await prisma.orderSync.findUnique({
    where: { netsuiteOrderId: payload.orderId },
  });

  if (existing) {
    return jsonResponse({ message: "Order already processed" }, 200);
  }

  /* -------------------------
     5. Load OFFLINE session
  -------------------------- */
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

  /* -------------------------
     6. Admin API client
  -------------------------- */
  const admin = createAdminApiClient({
    storeDomain: SHOP_DOMAIN,
    apiVersion: API_VERSION,
    accessToken: session.accessToken,
  });

  /* -------------------------
     7. Find company by metafield
  -------------------------- */
  const companySearchQuery =
    `metafields.netsuite.company_id:"${payload.company.id}"`;

  console.log("🔎 COMPANY SEARCH QUERY:", companySearchQuery);

  const companyQuery = `
    query ($query: String!) {
      companies(first: 1, query: $query) {
        nodes {
          id
          name
          locations(first: 1) {
            nodes {
              id
            }
          }
        }
      }
    }
  `;

  const companyRes = await admin.request(companyQuery, {
    variables: { query: companySearchQuery },
  });

  console.log(
    "📦 COMPANY SEARCH RAW RESPONSE:",
    JSON.stringify(companyRes, null, 2)
  );

  if (companyRes.errors?.length) {
    return jsonResponse(
      { error: companyRes.errors[0].message },
      400
    );
  }

  const companies = companyRes?.data?.companies?.nodes || [];

  if (!companies.length) {
    return jsonResponse(
      {
        error: "Company not found using metafield search",
        searchQuery: companySearchQuery,
      },
      422
    );
  }

  const company = companies[0];

  if (!company.locations.nodes.length) {
    return jsonResponse(
      { error: "Company has no active locations" },
      422
    );
  }

  const companyLocationId = company.locations.nodes[0].id;

  /* -------------------------
     8. Create order (NEW API)
  -------------------------- */
  const orderMutation = `
    mutation ($order: OrderCreateOrderInput!) {
      orderCreate(order: $order) {
        order {
          id
          name
        }
        userErrors {
          message
        }
      }
    }
  `;

  const orderRes = await admin.request(orderMutation, {
    variables: {
      order: {
        companyLocationId,
        sourceName: "NetSuite",
        financialStatus:
          payload.paymentStatus === "PAID"
            ? "PAID"
            : "PENDING",
        lineItems: payload.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          priceSet: {
            shopMoney: {
              amount: item.price.toString(),
              currencyCode: payload.currency,
            },
          },
        })),
      },
    },
  });

  console.log(
    "🧾 ORDER CREATE RAW RESPONSE:",
    JSON.stringify(orderRes, null, 2)
  );

  /* -------------------------
     9. Handle errors safely
  -------------------------- */
  if (orderRes.errors?.length) {
    const message = orderRes.errors[0].message;

    await prisma.orderSync.create({
      data: {
        netsuiteOrderId: payload.orderId,
        netsuiteCompanyId: payload.company.id,
        status: "FAILED",
        errorMessage: message,
      },
    });

    return jsonResponse({ error: message }, 400);
  }

  if (!orderRes.data || !orderRes.data.orderCreate) {
    return jsonResponse(
      { error: "Shopify returned no orderCreate data" },
      400
    );
  }

  const orderCreate = orderRes.data.orderCreate;

  if (orderCreate.userErrors.length) {
    const message = orderCreate.userErrors[0].message;

    await prisma.orderSync.create({
      data: {
        netsuiteOrderId: payload.orderId,
        netsuiteCompanyId: payload.company.id,
        status: "FAILED",
        errorMessage: message,
      },
    });

    return jsonResponse({ error: message }, 400);
  }

  /* -------------------------
     10. Save success
  -------------------------- */
  const shopifyOrderId = orderCreate.order.id;

  await prisma.orderSync.create({
    data: {
      netsuiteOrderId: payload.orderId,
      netsuiteCompanyId: payload.company.id,
      shopifyOrderId,
      status: "SUCCESS",
    },
  });

  console.log("✅ ORDER CREATED:", shopifyOrderId);

  return jsonResponse({
    success: true,
    shopifyOrderId,
  });
}
