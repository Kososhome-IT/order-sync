export async function findCustomerById(
  customerId
) {
  const result =
    await netsuite.request(
      `/customer/${customerId}`,
      "GET"
    );

  if (
    !result.success ||
    !result.data
  ) {
    return null;
  }

  return result.data;
}