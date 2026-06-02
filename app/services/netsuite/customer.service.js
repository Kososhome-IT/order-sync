import { netsuite } from "./netsuite.server";

export async function findCustomerByEmail(email) {
  const result = await netsuite.request(
    `/customer?q=${encodeURIComponent(
      `email IS "${email}"`
    )}`,
    "GET"
  );

  if (
    !result.success ||
    !result.data?.items?.length
  ) {
    return null;
  }

  return result.data.items[0];
}