import { json } from "../utils/jsonResponse";
import { netsuite } from "../services/netsuite/netsuite.server";

export async function loader() {
  //  customer find test
  // const email = "09designspc@gmail.com";

  // const result = await netsuite.request(
  //   `/customer?q=${encodeURIComponent(
  //     `email IS "${email}"`
  //   )}`,
  //   "GET"
  // );

  // console.log(
  //   "CUSTOMER SEARCH RESULT",
  //   JSON.stringify(result, null, 2)
  // );

  // return json(result);

  //  inventory item test
 const sku = "210341529";
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