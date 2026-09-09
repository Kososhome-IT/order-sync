import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { jsonResponse } from "../utils/jsonResponse";
import { net30_payment_mark_mutation } from  "../services/shopify/net30_manual_payment.service"
import { netsuite } from "../services/netsuite/netsuite.server";
import {
  updateNetSuiteOrderTypeWithRetry,
} from "../utils/payment.utils";
import { paymentRepository } from "../repositories/payment.repository";
import { syncLogger } from "../repositories/logger.service";
import {
  NETSUITE_CONFIG,
} from "../constants/integrationConfig";

const { customerDeposit: NETSUITE_CUSTOMER_DEPOSIT } = NETSUITE_CONFIG;

function toShopifyOrderGid(orderId) {
const value = String(orderId).trim();
return value.startsWith("gid://shopify/Order/") ? value : `gid://shopify/Order/${value}`;
}

export async function action({ request }) {
const operationId = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let payload = null;
let orderSync = null;
let shopifyOrderId = null;
let orderName = null;

console.log("[NetSuite Net_30  Manual Payment] START", { operationId, method: request.method });
// security check allwoing only post method
if (request.method !== "POST") {
return jsonResponse({ success: false, message: "Method not allowed" }, 405);
}

try {
    // check if there is valid json body 
try { payload = await request.json(); } 
catch (error) {
console.error("[NetSuite Net_30 Manual Payment] Invalid JSON body", {
operationId,
errorMessage: error?.message,
});

  return jsonResponse({ success: false, message: "Invalid JSON body" }, 400);
}

console.log("[NetSuite Net_30 Manual Payment] Request payload received", { operationId, payload });

// ordername  is required
orderName = String(payload.shopifyOrderName || "" ).trim();
if (!orderName) {
  return jsonResponse({ success: false, message: "orderName is required" }, 400);
}

// paymentAmount is required
const paymentAmount = payload.amount;
if (paymentAmount === undefined || paymentAmount === null || paymentAmount === "") {
  return jsonResponse(
    { success: false, message: "paymentAmount is required" }, 400
  );
}

const normalizedPaymentAmount = String(paymentAmount).trim();
const numericPaymentAmount = Number(normalizedPaymentAmount);

if (!Number.isFinite(numericPaymentAmount) || numericPaymentAmount <= 0) {
  return jsonResponse(
    {
      success: false,
      message: "paymentAmount must be a valid number greater than 0",
    },
    400
  );
}

const currencyCode = String( payload.currencyCode || payload.currency_code || "USD" ).trim().toUpperCase();

const paymentMethodName = String( payload.paymentMethodName || payload.payment_method_name ).trim();

const processedAt = payload.processedAt || payload.processed_at || null;

console.log("[NetSuite Manual Payment] Searching OrderSync by order name",{operationId, orderName, });

orderSync = await prisma.orderSync.findFirst({ where: { shopifyOrderName: orderName }, });


console.log("[NetSuite Manual Payment] OrderSync lookup completed", {
  operationId,
  found: Boolean(orderSync),
  orderSyncId: orderSync?.id || null,
  shopifyOrderName: orderSync?.shopifyOrderName || null,
  shopifyOrderId: orderSync?.shopifyOrderId || null,
});

if (!orderSync) {
   await syncLogger.failed({
  message: `Order not found in database: ${orderName}`,
  requestPayload: payload,
}); 
  return jsonResponse(
    {
      success: false,
      message: "OrderSync record not found",
      orderName,
    },
    404
  );
}

if (!orderSync.shopifyOrderId) {
  return jsonResponse(
    {
      success: false,
      message: "Shopify order ID is missing in OrderSync",
      orderName,
    },
    400
  );
}

shopifyOrderId = toShopifyOrderGid(orderSync.shopifyOrderId);

console.log("[NetSuite Manual Payment] Shopify Order ID resolved", {
  operationId,
  orderName,
  shopifyOrderId,
  orderSyncId: orderSync.id,
  paymentAmount: normalizedPaymentAmount,
  currencyCode,
  paymentMethodName,
  processedAt,
});

const shopDomain = process.env.SHOP;

console.log("[NetSuite Manual Payment] Creating unauthenticated Admin client", {
  operationId,
  shopDomain,
});

const { admin } = await unauthenticated.admin(shopDomain);

console.log("[NetSuite Manual Payment] Shopify Admin client created", {
  operationId,
  shopDomain,
  hasGraphql: typeof admin?.graphql === "function",
});

const net30_payment_mark_mutation_variables = {
  id: shopifyOrderId,
  amount: {
    amount: normalizedPaymentAmount,
    currencyCode,
  },
  processedAt,
};

console.log("[NetSuite Manual Payment] Calling orderCreateManualPayment", {operationId,shopifyOrderId,orderName,paymentAmount: normalizedPaymentAmount,currencyCode,paymentMethodName,processedAt});

const response = await admin.graphql( net30_payment_mark_mutation, {  variables: net30_payment_mark_mutation_variables, });
const responseData = await response.json();

console.log("[NetSuite Manual Payment] Shopify mutation response", {operationId, responseData});

if (responseData.errors?.length) {
  const message = responseData.errors.map((error) => error.message).join(", ");
  throw new Error(message);
}

const result = responseData.data?.orderCreateManualPayment;

if (!result) {
  throw new Error("Shopify did not return orderCreateManualPayment response");
}

if (result.userErrors?.length) {
  const errors = result.userErrors.map((error) => {
    const field = error.field?.length ? `${error.field.join(".")}:` : "";
    return {
      field: error.field || null,
      code: error.code || null,
      message: `${field} ${error.message}`,
    };
  });

  const message = errors.map((error) => error.message).join(", ");

  console.error("[NetSuite Manual Payment] Shopify user errors", {operationId,shopifyOrderId,orderName,errors,});

  return jsonResponse({
      success: false,
      message,
      errors,
      shopifyOrderId,
      shopifyOrderName: orderName,
    },
    422
  );}

if (!result.order) {throw new Error("Shopify did not return the updated order")}

const updatedOrder = result.order;

console.log("[NetSuite Manual Payment] SUCCESS", {
  operationId,
  shopifyOrderId: updatedOrder.id,
  shopifyOrderName: updatedOrder.name,
  financialStatus: updatedOrder.displayFinancialStatus,
  outstandingAmount: updatedOrder.totalOutstandingSet?.shopMoney?.amount || null,
  paymentAmount: normalizedPaymentAmount,

});
await syncLogger.success({
  orderSyncId: orderSync.id,
  eventType: "PAYMENT_CAPTURE",
  direction: "NETSUITE_TO_SHOPIFY",
  message: `Manual payment of ${normalizedPaymentAmount} recorded successfully`,
  requestPayload: payload,
  responsePayload: result,
});
const netsuiteCustomerId = orderSync.netsuiteCompanyId;
const netsuiteOrderId = orderSync.netsuiteOrderId;
const depositPayload = {
          customer: {
            id: netsuiteCustomerId.toString(),
          },
          salesOrder: {
            id: netsuiteOrderId.toString(),
          },
          payment: Number(normalizedPaymentAmount),
          memo: `Automated Deposit via Shopify Capture. Ref:`,
          [NETSUITE_CUSTOMER_DEPOSIT.fields.businessUnit]: {
            id: NETSUITE_CUSTOMER_DEPOSIT.businessUnitId,
          }
        };
const depositResult = await netsuite.createCustomerDeposit(depositPayload);      

if (depositResult.success) {
  await paymentRepository.createPaymentSync({
  netsuiteOrderId: orderSync.netsuiteOrderId,
  shopifyOrderId: updatedOrder.id,
  authorizationId: orderSync.shopifyOrderName,
  paymentReference: operationId,
  capturedAmount: numericPaymentAmount,
  status: "SUCCESS",
});  
  await syncLogger.success({
    orderSyncId: orderSync.id,
    eventType: "CUSTOMER_DEPOSIT",
    direction: "SHOPIFY_TO_NETSUITE",
    message: "NetSuite customer deposit created successfully",
    requestPayload: depositPayload,
    responsePayload: depositResult,
  });

  await updateNetSuiteOrderTypeWithRetry(netsuiteOrderId);
} else {
  await syncLogger.failed({
    orderSyncId: orderSync.id,
    eventType: "CUSTOMER_DEPOSIT",
    direction: "SHOPIFY_TO_NETSUITE",
    message: "NetSuite customer deposit creation failed",
    requestPayload: depositPayload,
    responsePayload: depositResult,
  });
  return jsonResponse({
  success: false,
  message: "Shopify payment captured,but NetSuite customer deposit creation failed",
  shopifyOrderId: updatedOrder.id,
  shopifyOrderName: updatedOrder.name,
  payment: { amount: normalizedPaymentAmount,
    currencyCode,
    paymentMethodName,
    processedAt,
  },
  financialStatus: updatedOrder.displayFinancialStatus,
  outstandingAmount:updatedOrder.totalOutstandingSet?.shopMoney?.amount || null,
  outstandingCurrency: updatedOrder.totalOutstandingSet?.shopMoney?.currencyCode || null,
});
}

return jsonResponse({
  success: true,
  message: "Manual payment recorded successfully",
  shopifyOrderId: updatedOrder.id,
  shopifyOrderName: updatedOrder.name,
  payment: { amount: normalizedPaymentAmount,
    currencyCode,
    paymentMethodName,
    processedAt,
  },
  financialStatus: updatedOrder.displayFinancialStatus,
  outstandingAmount:updatedOrder.totalOutstandingSet?.shopMoney?.amount || null,
  outstandingCurrency: updatedOrder.totalOutstandingSet?.shopMoney?.currencyCode || null,
});

} catch (error) {
console.error("[NetSuite Manual Payment] FAILED", {
operationId,
errorName: error?.name || null,
errorMessage: error?.message || null,
errorStack: error?.stack || null,
payload,
});
await syncLogger.failed({
  orderSyncId: orderSync?.id || null,
  eventType: "PAYMENT_CAPTURE",
  direction: "NETSUITE_TO_SHOPIFY",
  message: `Shopify manual payment failed: ${error?.message || "Unknown error"}`,
  requestPayload: payload,
responsePayload: null,
});
return jsonResponse({
    success: false,
    message: error?.message || "Failed to record manual payment",
  },
  500
);}}
