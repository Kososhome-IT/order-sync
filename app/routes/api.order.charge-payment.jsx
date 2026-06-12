import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { jsonResponse } from "../utils/jsonResponse";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { getAuthorizationTransaction,validateCaptureAmount} from "../services/shopify/payment.service";
export async function action({ request }) {
    let payload;
    const SHOP_DOMAIN = process.env.SHOP;
    const API_VERSION = "2025-07";

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { error: "Invalid JSON" },
      400
    );
  }
if (!payload.netsuiteOrderId) {
  return jsonResponse(
    {
      error: "netsuiteOrderId is required",
    },
    400
  );
}

if (!payload.captureAmount) {
  return jsonResponse(
    {
      error: "captureAmount is required",
    },
    400
  );
}

  const session = await sessionStorage.loadSession(
    `offline_${SHOP_DOMAIN}`
  );

  if (!session) {
  return jsonResponse(
    {
      error: "Offline session not found",
    },
    401
  );
}

  const admin = createAdminApiClient({
    storeDomain: SHOP_DOMAIN,
    apiVersion: API_VERSION,
    accessToken: session.accessToken,
  });

    const orderSync =
  await prisma.orderSync.findUnique({
    where: {
      netsuiteOrderId:
        payload.netsuiteOrderId,
    },
  });

if (!orderSync) {
  return jsonResponse(
    {
      error: "Order mapping not found",
    },
    404
  );
}

const authorization =
  await getAuthorizationTransaction(
    admin,
    orderSync.shopifyOrderId
  );

validateCaptureAmount(
  authorization,
  payload.captureAmount
);
console.log(
  "AUTHORIZATION",
  JSON.stringify(
    authorization,
    null,
    2
  )
);

return jsonResponse({
  success: true,
  authorization,
});

}