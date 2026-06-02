import fetch from "node-fetch";
import OAuth from "oauth-1.0a";
import crypto from "node:crypto";

/* =====================================================
 * BASIC CONFIG
 * ===================================================== */
const ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID;
const REALM = process.env.NETSUITE_REALM;

const BASE_URL = `https://${ACCOUNT_ID
  .toLowerCase()
  .replace("_", "-")}.suitetalk.api.netsuite.com`;

/* =====================================================
 * OAUTH SETUP
 * ===================================================== */
const oauth = new OAuth({
  consumer: {
    key: process.env.NETSUITE_CONSUMER_KEY,
    secret: process.env.NETSUITE_CONSUMER_SECRET,
  },
  signature_method: "HMAC-SHA256",
  hash_function(base_string, key) {
    return crypto
      .createHmac("sha256", key)
      .update(base_string)
      .digest("base64");
  },
});

/* =====================================================
 * SIGN REQUEST
 * ===================================================== */
function getSignedHeaders(url, method = "GET") {
  const request_data = { url, method };

  const token = {
    key: process.env.NETSUITE_TOKEN_ID,
    secret: process.env.NETSUITE_TOKEN_SECRET,
  };

  const authHeader = oauth.toHeader(
    oauth.authorize(request_data, token)
  );

  authHeader.Authorization =
    `OAuth realm="${REALM}", ` +
    authHeader.Authorization.substring(6);

  return {
    ...authHeader,
    "Content-Type": "application/json",
  };
}

/* =====================================================
 * GENERIC REQUEST WITH LOGGING
 * ===================================================== */
export async function netsuiteRequest(endpoint, method = "GET", body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const startTime = Date.now();

  try {
    console.log("🔹 NetSuite Request:", {
      method,
      endpoint,
    });

    const response = await fetch(url, {
      method,
      headers: getSignedHeaders(url, method),
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    const duration = Date.now() - startTime;

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    if (!response.ok) {
      console.error("❌ NetSuite API ERROR:", {
        endpoint,
        method,
        status: response.status,
        duration: `${duration}ms`,
        error: data,
      });

      throw new Error(
        `NetSuite ${response.status} - ${JSON.stringify(data)}`
      );
    }

    console.log("✅ NetSuite Success:", {
      endpoint,
      method,
      status: response.status,
      duration: `${duration}ms`,
    });

    return data;

  } catch (error) {
    console.error("🔥 NetSuite Request FAILED:", {
      endpoint,
      method,
      message: error.message,
    });

    throw error;
  }
}

/* =====================================================
 * HELPER FUNCTIONS
 * ===================================================== */
export async function createSalesOrder(orderData) {
  return netsuiteRequest(
    "/services/rest/record/v1/salesOrder",
    "POST",
    orderData
  );
}


export function getInventory(limit = 1) {
  return netsuiteRequest(
    `/services/rest/record/v1/inventoryItem?limit=${limit}`
  );
}

export function getCustomers(limit = 1) {
  return netsuiteRequest(
    `/services/rest/record/v1/customer?limit=${limit}`
  );
}
