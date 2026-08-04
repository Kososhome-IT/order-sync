const ORDER_LOOKUP_RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 20000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toShopifyOrderGid(orderID) {
  const value = String(orderID || "").trim();

  if (!value) {
    throw new Error("Shopify order ID is required");
  }

  if (value.startsWith("gid://shopify/Order/")) {
    return value;
  }

  return `gid://shopify/Order/${value}`;
}

async function fetchOrderPaymentMandate(admin, orderID) {
  const normalizedOrderID = toShopifyOrderGid(orderID);

  const orderResponse = await admin.request(
    `query getOrderPaymentMandate($orderId: ID!) {
      order(id: $orderId) {
        displayFinancialStatus
        paymentCollectionDetails {
          vaultedPaymentMethods {
            id
          }
        }
      }
    }`,
    {
      variables: { orderId: normalizedOrderID },
    }
  );

  console.log("RAW SHOPIFY RESPONSE for order:", JSON.stringify(orderResponse, null, 2));

  return {
    order: orderResponse?.data?.order,
    orderID: normalizedOrderID,
    orderResponse,
  };
}

/**
 * Fetches Shopify order and checks for a valid saved payment mandate.
 * @param {object} admin - Shopify Admin API Client
 * @param {string} orderID - The full Shopify Order Graphql ID (gid://shopify/Order/xxxx)
 */
export async function getOrderTransaction(admin, orderID) {
  const normalizedOrderID = toShopifyOrderGid(orderID);

  console.log(`[Payment Service] Fetching order details for ID: ${normalizedOrderID}`);

  let order = null;

  for (let attempt = 0; attempt < ORDER_LOOKUP_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = ORDER_LOOKUP_RETRY_DELAYS_MS[attempt];

    if (delayMs > 0) {
      console.log(
        `[Payment Service] Waiting ${delayMs}ms before retry ${attempt + 1} for order ${normalizedOrderID}`
      );
      await sleep(delayMs);
    }

    const result = await fetchOrderPaymentMandate(admin, normalizedOrderID);
    order = result.order;

    if (order) {
      break;
    }

    console.warn(
      `[Payment Service] Shopify returned no order for ${normalizedOrderID} on attempt ${attempt + 1}/${ORDER_LOOKUP_RETRY_DELAYS_MS.length}`
    );
  }

  // FIXED: Corrected response data path mapping from single order query
  if (!order) {
    console.error(`[Payment Service] ERROR: Order not found in Shopify for ID: ${normalizedOrderID}`);
    throw new Error(`Order not found: ${normalizedOrderID}`);
  }

  console.log(`[Payment Service] Order Found ID: ${normalizedOrderID}, Status: ${order.displayFinancialStatus}`);

  // Checks if the order is already paid to prevent double charging
  if (order.displayFinancialStatus === "PAID") {
    console.warn(`[Payment Service] Order with ID ${orderID} is already fully PAID.`);
    throw new Error(`Order is already fully paid.`);
  }

  // FIXED: Extracting id from the first item of the vaultedPaymentMethods array securely
  const vaultedMethods = order.paymentCollectionDetails?.vaultedPaymentMethods || [];
  const mandateId = vaultedMethods.length > 0 ? vaultedMethods[0].id : null;

  console.log(`[Payment Service] Extracted Mandate ID: ${mandateId}`);

  return {
    mandateId: mandateId,
  };
}


/**
 * Triggers an offline payment capture using a saved customer payment mandate.
 * * @param {Object} admin - The authenticated Shopify Admin API client instance
 * @param {Object} params
 * @param {string} params.orderId - The full GID of the Shopify order (e.g., 'gid://shopify/Order/123456')
 * @param {string} params.mandateId - The GID of the customer payment mandate
 * @param {string} params.idempotencyKey - A unique string token to prevent duplicate charging
 * @param {number|string} params.amount - The monetary value to capture
 * @param {string} [params.currencyCode="USD"] - Standard ISO currency string
 * @returns {Promise<Object>} The raw GraphQL mutation response from Shopify
 */
export async function createMandatePayment(admin, { orderId, mandateId, idempotencyKey, amount, currencyCode = "USD" }) {
  const normalizedOrderId = toShopifyOrderGid(orderId);
  const mutation = `#graphql
    mutation OrderCreateMandatePayment($amount: MoneyInput!, $autoCapture: Boolean!, $id: ID!, $idempotencyKey: String!, $mandateId: ID!) {
      orderCreateMandatePayment(amount: $amount, autoCapture: $autoCapture, id: $id, idempotencyKey: $idempotencyKey, mandateId: $mandateId) {
        job {
          id
          done
        }
        paymentReferenceId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await admin.request(mutation, {
    variables: {
      id: normalizedOrderId,
      mandateId: mandateId,
      idempotencyKey: idempotencyKey,
      autoCapture: true,
      amount: {
        amount: amount.toString(),
        currencyCode: currencyCode,
      },
    },
  });

  console.log(`[Payment Capture] RAW SHOPIFY MUTATION RESPONSE`, JSON.stringify(response, null, 2));
  return response;
}
