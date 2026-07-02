/**
 * Fetches Shopify order and checks for a valid saved payment mandate.
 * @param {object} admin - Shopify Admin API Client
 * @param {string} orderID - The full Shopify Order Graphql ID (gid://shopify/Order/xxxx)
 */
export async function getOrderTransaction(admin, orderID) {
  // FIXED: Removed undefined shopifyOrderName to prevent ReferenceError
  console.log(`[Payment Service] Fetching order details for ID: ${orderID}`);

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
      variables: { "orderId": orderID },
    }
  );

  console.log("RAW SHOPIFY RESPONSE for order:", JSON.stringify(orderResponse, null, 2));
  
  // FIXED: Corrected response data path mapping from single order query
  const order = orderResponse?.data?.order;

  if (!order) {
    console.error(`[Payment Service] ERROR: Order not found in Shopify for ID: ${orderID}`);
    throw new Error(`Order not found: ${orderID}`);
  }

  console.log(`[Payment Service] Order Found ID: ${orderID}, Status: ${order.displayFinancialStatus}`);

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
      id: orderId,
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