import { SHOPIFY_CONFIG } from "../../constants/integrationConfig";

function normalizeShopifyOrderId(orderId) {
  const value = String(orderId || "").trim();

  if (!value) {
    throw new Error("Shopify order ID is required");
  }

  return value.replace("gid://shopify/Order/", "");
}

export async function fetchShopifyOrderById({ shop, accessToken, orderId }) {
  if (!shop) {
    throw new Error("Shopify shop domain is required");
  }

  if (!accessToken) {
    throw new Error("Shopify access token is required");
  }

  const normalizedOrderId = normalizeShopifyOrderId(orderId);
  const url = `https://${shop}/admin/api/${SHOPIFY_CONFIG.apiVersions.adminRest}/orders/${normalizedOrderId}.json`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.errors ||
        data?.error ||
        `Shopify order fetch failed with HTTP ${response.status}`
    );
  }

  if (!data.order) {
    throw new Error(`Shopify order not found: ${normalizedOrderId}`);
  }

  return data.order;
}
