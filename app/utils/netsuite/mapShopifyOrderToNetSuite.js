export function mapShopifyOrderToNetSuite(order) {
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
  "terms": {
    "id": "2"
  },
  "otherRefNum": "92525-112933", // customer po number it should be unique always
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
