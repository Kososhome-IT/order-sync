import { PAYMENT_CONFIG } from "../../constants/integrationConfig";

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
  console.log(
    `[Payment Mandate fetchOrderPaymentMandate] START | Input Order ID: ${orderID}`
  );

  try {
    console.log(
      `[Payment Mandate fetchOrderPaymentMandate] Normalizing Shopify Order ID...`
    );

    const normalizedOrderID = toShopifyOrderGid(orderID);

    console.log(
      `[Payment Mandate fetchOrderPaymentMandate] Normalized Order ID: ${normalizedOrderID}`
    );

    console.log(
      `[Payment Mandate fetchOrderPaymentMandate] Sending Shopify GraphQL request | Order: ${normalizedOrderID}`
    );

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
        variables: {
          orderId: normalizedOrderID,
        },
      }
    );

    console.log(
      `[Payment Mandate fetchOrderPaymentMandate] Shopify GraphQL request completed | Order: ${normalizedOrderID}`
    );
console.log(
  "[Payment Mandate] FULL RESPONSE:",
  JSON.stringify(orderResponse, null, 2)
);
    // Check GraphQL-level errors returned by Shopify
    if (orderResponse?.errors?.length > 0) {
      console.error(
        `[Payment Mandate fetchOrderPaymentMandate] ❌ Shopify GraphQL errors | Order: ${normalizedOrderID}`
      );

      console.error(
        `[Payment Mandate fetchOrderPaymentMandate] GraphQL errors:`,
        JSON.stringify(orderResponse.errors, null, 2)
      );
    }

    const order = orderResponse?.data?.order;

    if (!order) {
      console.error(
        `[Payment Mandate fetchOrderPaymentMandate] ❌ Shopify returned no order | Order: ${normalizedOrderID}`
      );

      console.error(
        `[Payment Mandate fetchOrderPaymentMandate] Response data:`,
        JSON.stringify(orderResponse?.data || {}, null, 2)
      );
    } else {
      console.log(
        `[Payment Mandate fetchOrderPaymentMandate] Order found | Order: ${normalizedOrderID} | Financial Status: ${
          order.displayFinancialStatus || "UNKNOWN"
        }`
      );

      const vaultedPaymentMethods =
        order?.paymentCollectionDetails?.vaultedPaymentMethods || [];

      console.log(
        `[Payment Mandate fetchOrderPaymentMandate] Vaulted payment methods found: ${vaultedPaymentMethods.length} | Order: ${normalizedOrderID}`
      );

      if (vaultedPaymentMethods.length > 0) {
        console.log(
          `[Payment Mandate fetchOrderPaymentMandate] ✅ Payment mandate available | Order: ${normalizedOrderID}`
        );
      } else {
        console.warn(
          `[Payment Mandate fetchOrderPaymentMandate] ⚠️ No vaulted payment method found | Order: ${normalizedOrderID}`
        );
      }
    }

    console.log(
      `[Payment Mandate fetchOrderPaymentMandate] SUCCESS | Order: ${normalizedOrderID}`
    );

    return {
      order,
      orderID: normalizedOrderID,
      orderResponse,
    };
  } catch (error) {
    console.error(
      `[Payment Mandate fetchOrderPaymentMandate] ❌ FAILED | Input Order ID: ${orderID}`
    );

    console.error(
      `[Payment Mandate fetchOrderPaymentMandate] Error name: ${error?.name || "Unknown"}`
    );

    console.error(
      `[Payment Mandate fetchOrderPaymentMandate] Error message: ${
        error?.message || "Unknown error"
      }`
    );

    console.error(
      `[Payment Mandate] Error stack:`,
      error?.stack || "Stack unavailable"
    );

    console.error(
      `[Payment Mandate] Full error object:`,
      error
    );

    // Re-throw so the existing caller can handle the failure
    throw error;
  }
}

/**
 * Fetches Shopify order and checks for a valid saved payment mandate.
 * @param {object} admin - Shopify Admin API Client
 * @param {string} orderID - The full Shopify Order Graphql ID (gid://shopify/Order/xxxx)
 */
export async function getOrderTransaction(admin, orderID) {
  console.log(
    `[Payment Service] ===== getOrderTransaction START =====`
  );
  console.log(
    `[Payment Service] Input Order ID: ${orderID}`
  );

  try {
    const normalizedOrderID = toShopifyOrderGid(orderID);

    console.log(
      `[Payment Service] Order ID normalized successfully: ${normalizedOrderID}`
    );

    console.log(
      `[Payment Service] Fetching order details for ID: ${normalizedOrderID}`
    );

    let order = null;

    const totalAttempts =
      PAYMENT_CONFIG.shopifyOrderLookupRetryDelaysMs.length;

    console.log(
      `[Payment Service] Shopify order lookup configured for ${totalAttempts} attempt(s)`
    );

    for (
      let attempt = 0;
      attempt < PAYMENT_CONFIG.shopifyOrderLookupRetryDelaysMs.length;
      attempt += 1
    ) {
      const delayMs =
        PAYMENT_CONFIG.shopifyOrderLookupRetryDelaysMs[attempt];

      console.log(
        `[Payment Service] Lookup attempt ${attempt + 1}/${totalAttempts} started | Order: ${normalizedOrderID} | Delay: ${delayMs}ms`
      );

      if (delayMs > 0) {
        console.log(
          `[Payment Service] Waiting ${delayMs}ms before retry ${attempt + 1} | Order: ${normalizedOrderID}`
        );

        await sleep(delayMs);

        console.log(
          `[Payment Service] Wait completed | Starting Shopify lookup attempt ${attempt + 1}/${totalAttempts}`
        );
      }

      console.log(
        `[Payment Service] Calling fetchOrderPaymentMandate | Attempt: ${attempt + 1}/${totalAttempts} | Order: ${normalizedOrderID}`
      );

      const result = await fetchOrderPaymentMandate(
        admin,
        normalizedOrderID
      );

      console.log(
        `[Payment Service] fetchOrderPaymentMandate completed | Attempt: ${attempt + 1}/${totalAttempts} | Order returned: ${Boolean(
          result?.order
        )}`
      );

      order = result.order;

      if (order) {
        console.log(
          `[Payment Service] ✅ Shopify order found on attempt ${attempt + 1}/${totalAttempts} | Order: ${normalizedOrderID}`
        );
        break;
      }

      console.warn(
        `[Payment Service] ⚠️ Shopify returned no order | Attempt: ${attempt + 1}/${totalAttempts} | Order: ${normalizedOrderID}`
      );
    }

    if (!order) {
      console.error(
        `[Payment Service] ❌ ERROR: Order not found in Shopify after ${totalAttempts} attempt(s) | Order: ${normalizedOrderID}`
      );

      const error = new Error(
        `Order not found: ${normalizedOrderID}`
      );

      console.error(
        `[Payment Service] Throwing order-not-found error | Message: ${error.message}`
      );

      throw error;
    }

    console.log(
      `[Payment Service] Order Found | ID: ${normalizedOrderID} | Financial Status: ${
        order.displayFinancialStatus || "UNKNOWN"
      }`
    );

    // Checks if the order is already paid to prevent double charging
    if (order.displayFinancialStatus === "PAID") {
      console.warn(
        `[Payment Service] ⚠️ Order is already fully PAID | Order: ${normalizedOrderID} | Original ID: ${orderID}`
      );

      const error = new Error(
        `Order is already fully paid.`
      );

      console.error(
        `[Payment Service] ❌ Preventing duplicate charge | Order: ${normalizedOrderID} | Message: ${error.message}`
      );

      throw error;
    }

    console.log(
      `[Payment Service] Order is eligible to continue payment processing | Financial Status: ${order.displayFinancialStatus}`
    );

    // FIXED: Extracting id from the first item of the vaultedPaymentMethods array securely
    const vaultedMethods =
      order.paymentCollectionDetails?.vaultedPaymentMethods || [];

    console.log(
      `[Payment Service] Vaulted payment methods found: ${vaultedMethods.length} | Order: ${normalizedOrderID}`
    );

    const mandateId =
      vaultedMethods.length > 0
        ? vaultedMethods[0].id
        : null;

    if (mandateId) {
      console.log(
        `[Payment Service] ✅ Mandate ID extracted successfully | Order: ${normalizedOrderID} | Mandate ID: ${mandateId}`
      );
    } else {
      console.warn(
        `[Payment Service] ⚠️ No vaulted payment method / mandate found | Order: ${normalizedOrderID}`
      );
    }

    console.log(
      `[Payment Service] getOrderTransaction SUCCESS | Order: ${normalizedOrderID}`
    );
    console.log(
      `[Payment Service] ===== getOrderTransaction END =====`
    );

    return {
      mandateId: mandateId,
    };
  } catch (error) {
    console.error(
      `[Payment Service] ❌ getOrderTransaction FAILED | Input Order ID: ${orderID}`
    );

    console.error(
      `[Payment Service] Error name: ${
        error?.name || "UnknownError"
      }`
    );

    console.error(
      `[Payment Service] Error message: ${
        error?.message || "Unknown error"
      }`
    );

    console.error(
      `[Payment Service] Error stack:`,
      error?.stack || "Stack unavailable"
    );

    console.error(
      `[Payment Service] Full error object:`,
      error
    );

    console.error(
      `[Payment Service] ===== getOrderTransaction FAILED =====`
    );

    // Re-throw the exact original error.
    // No error is swallowed or replaced.
    throw error;
  }
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

  // console.log(`[Payment Capture] RAW SHOPIFY MUTATION RESPONSE`, JSON.stringify(response, null, 2));
  return response;
}
