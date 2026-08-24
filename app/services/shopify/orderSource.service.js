export async function getOrderSource(admin, orderId) {
  const query = `#graphql
    query GetOrder($id: ID!) {
      order(id: $id) {
        metafield(
          namespace: "custom"
          key: "order_source"
        ) {
          value
        }
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: {
      id: `gid://shopify/Order/${orderId}`,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Shopify Order Source API returned HTTP ${response.status}`
    );
  }

  if (result.errors?.length) {
    throw new Error(
      `Shopify Order Source GraphQL request failed: ${JSON.stringify(
        result.errors
      )}`
    );
  }

  return result.data?.order?.metafield?.value || null;
}