import { mapShopifyOrderToNetSuite } from "./mapShopifyOrderToNetSuite";
import { netsuiteRequest,createSalesOrder } from "./netsuiteClient";


export async function createNetSuiteSalesOrder(shopifyOrder) {
  const body = mapShopifyOrderToNetSuite(shopifyOrder);

  const response = await netsuiteRequest({
    method: "POST",
    path: "/services/rest/record/v1/salesOrder",
    body,
  });

  return response;
}
