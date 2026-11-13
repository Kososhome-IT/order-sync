const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export function isRetryablePaymentFailure(message = "") {
  const normalized = String(message).toLowerCase();
  return /card[^.]*declin|declined[^.]*card|insufficient funds/.test(normalized);
}

export function failureReasonFromLog(log) {
  const response = log?.responsePayload || {};
  const paymentStatus = response?.paymentStatus || {};
  const userErrors = response?.orderCreateMandatePayment?.userErrors || [];
  const messages = [
    log?.message,
    paymentStatus?.errorMessage,
    ...userErrors.map((error) => error?.message),
  ].filter(Boolean);

  return messages.join(" | ");
}

export function nextPacificRetryAt(from = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const current = Object.fromEntries(formatter.formatToParts(from).map(({ type, value }) => [type, value]));
  const target = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day) + 1, 7));
  const targetLocalEpoch = target.getTime();
  let candidate = new Date(targetLocalEpoch + 8 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = Object.fromEntries(formatter.formatToParts(candidate).map(({ type, value }) => [type, value]));
    const localEpoch = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
    candidate = new Date(candidate.getTime() + targetLocalEpoch - localEpoch);
  }

  return candidate;
}

export function normalizePaymentAttemptDateTime(value) {
  if (!value) return "";
  const input = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return "";
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function paymentKey(shop, orderSyncId, paymentAttemptDateTime) {
  const normalizedDateTime = normalizePaymentAttemptDateTime(paymentAttemptDateTime);
  if (!normalizedDateTime) return "";
  return `${String(shop || "").trim().toLowerCase()}:${String(orderSyncId)}:${normalizedDateTime}`;
}
