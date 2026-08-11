import { netsuite } from "../services/netsuite/netsuite.server";
import { NETSUITE_CONFIG, PAYMENT_CONFIG } from "../constants/integrationConfig";

const { salesOrder: NETSUITE_SALES_ORDER } = NETSUITE_CONFIG;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function getNetSuiteErrorMessage(result) {
  return (
    result?.data?.["o:errorDetails"]?.map((error) => error.detail)?.join(", ") ||
    result?.data?.message ||
    "NetSuite sales order status update failed"
  );
}

export function isRecordChangedError(result) {
  return getNetSuiteErrorMessage(result).includes("Record has been changed");
}

export async function updateNetSuiteOrderTypeWithRetry(netsuiteOrderId) {
  let lastResult = null;

  for (let attempt = 0; attempt < PAYMENT_CONFIG.netsuiteOrderUpdateRetryDelaysMs.length; attempt += 1) {
    const delayMs = PAYMENT_CONFIG.netsuiteOrderUpdateRetryDelaysMs[attempt];

    if (delayMs > 0) {
      console.log(`[NetSuite Update Order] Waiting ${delayMs}ms before retry ${attempt + 1} for Sales Order ${netsuiteOrderId}`);
      await sleep(delayMs);
    }

    lastResult = await netsuite.updateOrderFields(netsuiteOrderId, {
      [NETSUITE_SALES_ORDER.fields.orderType]: {
        id: NETSUITE_SALES_ORDER.orderTypeIds.readyToWave,
      },
      [NETSUITE_SALES_ORDER.fields.depositAmountCharge]: null,
    });

    if (lastResult.success || !isRecordChangedError(lastResult)) {
      return { ...lastResult, attempts: attempt + 1 };
    }
  }

  return { ...lastResult, attempts: PAYMENT_CONFIG.netsuiteOrderUpdateRetryDelaysMs.length };
}

export async function updateNetSuiteOrderChargeDecline(netsuiteOrderId) {
     await netsuite.updateOrderFields(netsuiteOrderId, {
      [NETSUITE_SALES_ORDER.fields.orderType]: {
        id: NETSUITE_SALES_ORDER.orderTypeIds.chargeDecline,
      }
    });
  return {  };
}
