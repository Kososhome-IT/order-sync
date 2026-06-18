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