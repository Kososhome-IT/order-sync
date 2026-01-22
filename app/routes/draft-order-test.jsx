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
   7. Find company by metafield (ROBUST + DEBUG)
-------------------------- */
const companyQuery = `
  query {
    companies(first: 50) {
      nodes {
        id
        name
        netsuite: metafield(namespace: "netsuite", key: "company_id") {
          value
        }
        custom: metafield(namespace: "custom", key: "company_id") {
          value
        }
        locations(first: 1) {
          nodes {
            id
          }
        }
      }
    }
  }
`;

const companyRes = await admin.request(companyQuery);

console.log(
  "📦 COMPANY METAFIELD DEBUG:",
  JSON.stringify(companyRes, null, 2)
);

if (companyRes.errors?.length) {
  return jsonResponse(
    { error: companyRes.errors[0].message },
    400
  );
}

const companies = companyRes?.data?.companies?.nodes || [];

/* --- EXACT MATCH, TRIM SAFE --- */
const company = companies.find((c) => {
  const netsuiteId = c.netsuite?.value?.trim();
  const customId = c.custom?.value?.trim();

  return (
    netsuiteId === payload.company.id ||
    customId === payload.company.id
  );
});

if (!company) {
  return jsonResponse(
    {
      error: "Company not found after direct metafield read",
      searchedFor: payload.company.id,
      hint: "Check logs: 📦 COMPANY METAFIELD DEBUG",
    },
    422
  );
}

if (!company.locations.nodes.length) {
  return jsonResponse(
    { error: "Company has no active locations" },
    422
  );
}

const companyLocationId = company.locations.nodes[0].id;


  /* -------------------------
     8. CREATE DRAFT ORDER (B2B SAFE)
  -------------------------- */
  const draftOrderMutation = `
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          name
          status
          invoiceUrl
        }
        userErrors {
          message
        }
      }
    }
  `;

  const draftRes = await admin.request(draftOrderMutation, {
    variables: {
      input: {
        companyLocationId,
        note: `NetSuite Order ${payload.orderId}`,
        tags: ["netsuite", "b2b"],
        useCustomerDefaultAddress: true,
        lineItems: payload.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          originalUnitPrice: item.price.toString(),
        })),
      },
    },
  });

  console.log(
    "🧾 DRAFT ORDER RAW RESPONSE:",
    JSON.stringify(draftRes, null, 2)
  );

  /* -------------------------
     9. Handle errors
  -------------------------- */
  if (!draftRes.data || !draftRes.data.draftOrderCreate) {
    return jsonResponse(
      { error: "Shopify returned no draftOrderCreate data" },
      400
    );
  }

  const draftCreate = draftRes.data.draftOrderCreate;

  if (draftCreate.userErrors.length) {
    const message = draftCreate.userErrors[0].message;

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
  const shopifyDraftOrderId = draftCreate.draftOrder.id;

  await prisma.orderSync.create({
    data: {
      netsuiteOrderId: payload.orderId,
      netsuiteCompanyId: payload.company.id,
      shopifyOrderId: shopifyDraftOrderId,
      status: "SUCCESS",
    },
  });

  console.log("✅ DRAFT ORDER CREATED:", shopifyDraftOrderId);

  return jsonResponse({
    success: true,
    shopifyDraftOrderId,
    invoiceUrl: draftCreate.draftOrder.invoiceUrl,
  });
}
