export async function getAuthorizationTransaction(
  admin,
  shopifyOrderId
) {
  const query = `
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        displayFinancialStatus

        transactions {
          id
          kind
          status

          amountSet {
            shopMoney {
              amount
            }
          }
        }
      }
    }
  `;

  const response = await admin.request(query, {
    variables: {
      id: shopifyOrderId,
    },
  });

  const transactions =
    response?.data?.order?.transactions || [];

  const authorization =
    transactions.find(
      transaction =>
        transaction.kind === "AUTHORIZATION" &&
        transaction.status === "SUCCESS"
    );

  if (!authorization) {
    throw new Error(
      "Authorization transaction not found"
    );
  }

  return authorization;
}