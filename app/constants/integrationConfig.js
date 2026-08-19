export const SHOPIFY_CONFIG = {
  apiVersions: {
    adminGraphql: "2026-07",
    adminRest: "2026-04",
  },
  order: {
    readyToChargeTypeName: "Shopify Ready To Charge",
  },
};

export const NETSUITE_CONFIG = {
  salesOrder: {
    customFormId: "216",
    subsidiaryId: "2",
    termsId: "2",
    accountSpecId: "562637",
    orderSourceId: "8",
    orderAttributeId: "54",
    segmentId: "3",
    shippingMethodId_1: "26506",
    order_customer_pick:'21',
    shippingMethodId_2: "58",// classic home freight
    orderTypeIds: {
      readyToCharge: "7",
      readyToWave: "2",
      chargeDecline: "12",
    },
    fields: {
      orderType: "custbody_wmsse_ordertype",
      webOrderNumber: "custbody_ch_om_web_order_number",
      accountSpec: "custbody_ch_so_acc_spec",
      orderSource: "custbody_ch_om_ordersource",
      orderAttribute: "custbody_ch_ord_attribute",
      depositAmountCharge: "custbody_ch_deposit_amount_charge_shop",
      businessUnit: "cseg1",
    },
    customShippingAddress: {
      shipAddressListId: "-2",
      isResidential: false,
      patchDelayMs: 120000,
    },
  },
  customerDeposit: {
    businessUnitId: "3",
    paymentOptionId: "224151",
    fields: {
      webPaymentTokenRef: "custbody_ch_web_payment_token_ref",
      businessUnit: "cseg1",
      paymentOption: "paymentoption",
    },
  },
};

export const PAYMENT_CONFIG = {
  jobPolling: {
    maxAttempts: 6,
    delayMs: 20000,
  },
  shopifyOrderLookupRetryDelaysMs: [0, 2000, 5000, 10000, 20000],
  netsuiteOrderUpdateRetryDelaysMs: [0, 2000, 5000, 10000],
};
