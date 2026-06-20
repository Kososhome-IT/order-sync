import { netsuite } from "./netsuite.server";

export async function findItemBySku(sku) {
  let result = await netsuite.request(
    `/inventoryItem?q=${encodeURIComponent(
      `itemId IS "${sku}"`
    )}`,
    "GET"
  );

  // if not fouond in inventory check in kits
  if (!result.success || !result.data?.items?.length) {
    result = await netsuite.request(
      `/kitItem?q=${encodeURIComponent(`itemId IS "${sku}"`)}`,
      "GET"
    );
  }

 if (!result.success || !result.data?.items?.length) {
    return null;
  }

  return result.data.items[0];
}