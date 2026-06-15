export async function getOrderSource(
  admin,
  orderId
) {
  const query = `
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

  const response =
    await admin.request(query, {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
      },
    });

  return response?.data?.order
    ?.metafield?.value;
}