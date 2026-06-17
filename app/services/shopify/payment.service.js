export async function getAuthorizationTransaction(
  admin,
  shopifyOrderName
) {
  // const query = `
  //   query GetOrder($id: ID!) {
  //     order(id: $id) {
  //       id
  //       displayFinancialStatus

  //       transactions {
  //         id
  //         kind
  //         status

  //         amountSet {
  //           shopMoney {
  //             amount
  //           }
  //         }
  //       }
  //     }
  //   }
  // `;

  // const response = await admin.request(query, {
  //   variables: {
  //     id: shopifyOrderId,
  //   },
  // });

  // const transactions =
  //   response?.data?.order?.transactions || [];

  // const authorization =
  //   transactions.find(
  //     transaction =>
  //       transaction.kind === "AUTHORIZATION" &&
  //       transaction.status === "SUCCESS"
  //   );

  // if (!authorization) {
  //   throw new Error(
  //     "Authorization transaction not found"
  //   );
  // }

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
          gateway
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

const order =
  orderResponse?.data?.orders?.nodes?.[0];

if (!order) {
  throw new Error(
    `Order not found: ${shopifyOrderName}`
  );
}


    if (
      order.displayFinancialStatus ===
      "PAID"
    ) {
      return json({
        success: true,
        message:
          "Order already paid",
      });
    }

    const authorization =
      order.transactions.find(
        (t) =>
          t.kind ===
            "AUTHORIZATION" &&
          t.status === "SUCCESS"
      );

  return {
  orderId: order.id,
  orderName: order.name,
  authorization,
};
}