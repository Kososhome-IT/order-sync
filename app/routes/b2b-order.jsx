// import { json } from "@remix-run/node";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { sessionStorage } from "../shopify.server";

/**
 * POST /api/create-b2b-order
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export async function action({ request }) {
  try {
    /* -------------------------
       Get Shopify Admin Session
    -------------------------- */
    const SHOP_DOMAIN = "dummy-ranjit.myshopify.com";
    const session = await sessionStorage.loadSession(
    `offline_${SHOP_DOMAIN}`
  );

    if (!session || !session.shop || !session.accessToken) {
      return jsonResponse({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminApiClient({
      storeDomain: session.shop,
      apiVersion: "2025-04",
      accessToken: session.accessToken,
    });

    /* -------------------------
       Request Payload (example)
       You may also read this
       from request.json()
    -------------------------- */
    const {
        orderId,
      customerId,
      companyLocationId,
      variantId,
      quantity = 1,
    } = await request.json();

    if (!customerId || !companyLocationId || !variantId) {
      return jsonResponse(
        {
          success: false,
          error: "customerId, companyLocationId and variantId are required",
        },
        { status: 400 }
      );
    }

    /* -------------------------
       GraphQL Mutation
    -------------------------- */
    const mutation = `
      mutation orderCreate($input: OrderInput!) {
        orderCreate(input: $input) {
          order {
            id
            name
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        orderId,
        customerId,
        companyLocationId,
        lineItems: [
          {
            variantId,
            quantity,
          },
        ],
        currencyCode: "INR",
      },
    };

    const response = await adminClient.request(mutation, {
      variables,
    });

    const result = response.data.orderCreate;

    if (result.userErrors.length) {
      return jsonResponse(
        {
          success: false,
          errors: result.userErrors,
        },
        { status: 422 }
      );
    }

    return jsonResponse({
      success: true,
      order: result.order,
    });
  } catch (error) {
    console.error("B2B Order Create Error:", error);

    return jsonResponse(
      {
        success: false,
        error: "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
