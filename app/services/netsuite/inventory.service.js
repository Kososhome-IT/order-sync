import { netsuite } from "./netsuite.server";

export async function findItemBySku(sku) {
  const itemTypes = [
    "inventoryItem",
    "kitItem",
    "assemblyItem",
    "nonInventorySaleItem",
    "serviceSaleItem",
    "otherChargeSaleItem",
  ];

  for (const type of itemTypes) {
    const result = await netsuite.request(
      `/${type}?q=${encodeURIComponent(
        `itemId IS "${sku}"`
      )}`,
      "GET"
    );

    if (
      result.success &&
      result.data?.items?.length
    ) {
      console.log(
        `Found ${sku} in ${type}`
      );

      return result.data.items[0];
    }
  }

  return null;
}