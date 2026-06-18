/**
 * Fetches Shopify order and checks for a valid, unexpired authorization transaction.
 * @param {object} admin - Shopify Admin API Client
 * @param {string} shopifyOrderName - The order name (e.g., #1001)
 */
export async function getAuthorizationTransaction(admin, shopifyOrderName) {
  console.log(`[Payment Service] Fetching order details for: ${shopifyOrderName}`);

  const orderResponse = await admin.request(
    `
    query GetOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        nodes {
          id
          name
          displayFinancialStatus
          paymentMandate {
            id
          }
          transactions {
            id
            kind
            status
            gateway
            createdAt
          }
        }
      }
    }
    `,
    {
      variables: { query: `name:${shopifyOrderName}` },
    }
  );

  const order = orderResponse?.data?.orders?.nodes?.[0];

  if (!order) {
    console.error(`[Payment Service] ERROR: Order not found in Shopify: ${shopifyOrderName}`);
    throw new Error(`Order not found: ${shopifyOrderName}`);
  }

  console.log(`[Payment Service] Order Found ID: ${order.id}, Status: ${order.displayFinancialStatus}`);
  console.log(`[Payment Service] Total Transactions Found: ${order.transactions?.length}`);

  if (order.displayFinancialStatus === "PAID") {
    console.warn(`[Payment Service] Order ${shopifyOrderName} is already fully PAID.`);
    throw new Error(`Order ${shopifyOrderName} is already fully paid.`);
  }

  // Find a successful AUTHORIZATION transaction
  const authorization = order.transactions.find(
    (t) => t.kind === "AUTHORIZATION" && t.status === "SUCCESS"
  );

  let isExpiredOrMissing = true;

  if (authorization) {
    const authDate = new Date(authorization.createdAt);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate - authDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    console.log(`[Payment Service] Found AUTHORIZATION [${authorization.id}]. Age: ${diffDays} days.`);

    // If authorization is within 7 days, we consider it valid for standard capture
    if (diffDays <= 7) {
      isExpiredOrMissing = false;
    } else {
      console.log(`[Payment Service] Authorization is older than 7 days. Will force Vaulted Card routing.`);
    }
  } else {
    console.log(`[Payment Service] No successful AUTHORIZATION transaction found.`);
  }

  return {
    orderId: order.id,
    orderName: order.name,
    displayFinancialStatus: order.displayFinancialStatus,
    mandateId: order.paymentMandate?.id || null,
    authorization: isExpiredOrMissing ? null : authorization, // Returns null if expired to force Vaulted Card
  };
}