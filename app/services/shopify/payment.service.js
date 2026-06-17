/**
 * Fetches Shopify order and checks if there is an active authorization transaction.
 * @param {object} admin - Shopify Admin API Client
 * @param {string} shopifyOrderName - The order name (e.g., #1001)
 */
export async function getOrderAuthorizationDetails(admin, shopifyOrderName) {
  const orderResponse = await admin.request(
    `
    query GetOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        nodes {
          id
          name
          displayFinancialStatus
          transactions {
            id
            kind
            status
            createdAt
          }
        }
      }
    }
    `,
    {
      variables: {
        query: `name:${shopifyOrderName}`,
      },
    }
  );

  const order = orderResponse?.data?.orders?.nodes?.[0];

  if (!order) {
    throw new Error(`Order not found: ${shopifyOrderName}`);
  }

  // If the order is already fully paid, throw an error to stop execution
  if (order.displayFinancialStatus === "PAID") {
    throw new Error(`Order ${shopifyOrderName} is already fully paid.`);
  }

  // Look for a successful AUTHORIZATION transaction
  const authorization = order.transactions.find(
    (t) => t.kind === "AUTHORIZATION" && t.status === "SUCCESS"
  );

  return {
    orderId: order.id,
    orderName: order.name,
    displayFinancialStatus: order.displayFinancialStatus,
    authorization, // This will be undefined if no authorization exists
  };
}