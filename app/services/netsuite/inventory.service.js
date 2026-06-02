import { netsuite } from "./netsuite.server";

export async function findItemBySku(sku) {
  const result = await netsuite.request(
    `/inventoryItem?q=${encodeURIComponent(
      `itemId IS "${sku}"`
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