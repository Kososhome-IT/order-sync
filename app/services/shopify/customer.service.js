export async function findCustomerByEmail(
  admin,
  email
) {
  const query = `
    query GetCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
             defaultEmailAddress{
              emailAddress
            }
          }
        }
      }
    }
  `;

  const response = await admin.request(query, {
    variables: {
      query: `email:${email}`,
    },
  });

    console.log(
    "CUSTOMER RESPONSE:",
    JSON.stringify(response, null, 2)
  );

  const customer =
    response?.data?.customers?.edges?.[0]?.node;

  if (!customer) {
    throw new Error(
      `Customer not found for email ${email}`
    );
  }

  return customer;
}