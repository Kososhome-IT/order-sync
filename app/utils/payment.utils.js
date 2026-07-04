const NETSUITE_READY_TO_WAVE_ID = "2";
const NETSUITE_CHARGE_DECLINE_ID = "12";
const NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS = [0, 2000, 5000, 10000];
const NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD = "custbody_ch_deposit_amount_charge_shop";
import { netsuite } from "../services/netsuite/netsuite.server";

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

  for (let attempt = 0; attempt < NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS[attempt];

    if (delayMs > 0) {
      console.log(`[NetSuite Update Order] Waiting ${delayMs}ms before retry ${attempt + 1} for Sales Order ${netsuiteOrderId}`);
      await sleep(delayMs);
    }

    lastResult = await netsuite.updateOrderFields(netsuiteOrderId, {
      custbody_wmsse_ordertype: {
        id: NETSUITE_READY_TO_WAVE_ID,
      },
      [NETSUITE_DEPOSIT_AMOUNT_CHARGE_FIELD]: null,
    });

    if (lastResult.success || !isRecordChangedError(lastResult)) {
      return { ...lastResult, attempts: attempt + 1 };
    }
  }

  return { ...lastResult, attempts: NETSUITE_ORDER_UPDATE_RETRY_DELAYS_MS.length };
}

export async function updateNetSuiteOrderChargeDecline(netsuiteOrderId) {
     await netsuite.updateOrderFields(netsuiteOrderId, {
      custbody_wmsse_ordertype: {
        id: NETSUITE_CHARGE_DECLINE_ID,
      }
    });
  return {  };
}