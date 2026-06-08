export function mapShopifyOrderToNetSuite(order) {
  const shopifyOrderNumber = order.name || String(order.order_number || "");
  const shopifyPoNumber = getShopifyPoNumber(order);
 
  return {
     "customForm": {
    "id": "216"
  },
  "entity": {
    "id": "1198517"
  },
  "subsidiary": {
    "id": "2"
  },
  ...(shopifyPoNumber ? { "otherRefNum": shopifyPoNumber } : {}),
  "custbody_ch_om_web_order_number": shopifyOrderNumber,
  "custbody_ch_so_acc_spec": {
    "id": "562637"
  },
  "custbody_ch_om_ordersource": {
    "id": "8"
  },
  "custbody_ch_ord_attribute": {
    "items": [
      {
        "id": "54"
      }
    ]
  },
  "cseg1": {
    "id": "3"
  },
  "item": {
    "items": [
      {
        "item": {
          "id": "358"
        },
        "quantity": 1,
        "rate": 5.00
      }
    ]
  }
  };
}
 
function getShopifyPoNumber(order) {
  const directPoNumber =
    order.po_number ||
    order.poNumber ||
    order.purchase_order_number ||
    order.purchaseOrderNumber;
 
  if (directPoNumber) {
    return String(directPoNumber);
  }
 
  const poAttribute = order.note_attributes?.find((attribute) => {
    const name = String(attribute.name || "").toLowerCase();
 
    return [
      "po number",
      "po_number",
      "purchase order",
      "purchase order number",
    ].includes(name);
  });
 
  return poAttribute?.value ? String(poAttribute.value) : null;
}
 