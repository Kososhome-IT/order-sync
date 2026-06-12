
import { netsuite } from "./netsuite.server";
export async function findCustomerById(
  customerId
) {
  const result =
    await netsuite.request(
      `/customer/${customerId}`,
      "GET"
    );

  if (!result.success) {
    return null;
  }

  return result.data;
}