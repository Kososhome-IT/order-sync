import crypto from "crypto";
 
export function verifyShopifyHmacResult(request, rawBody) {
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
 
  if (!hmacHeader) {
    return {
      ok: false,
      reason: "missing_x_shopify_hmac_sha256_header",
    };
  }
 
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY;
  if (!secret) {
    return {
      ok: false,
      reason: "missing_shopify_api_secret_env",
    };
  }
 
  const generatedHmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
 
  const generatedBuffer = Buffer.from(generatedHmac, "base64");
  const headerBuffer = Buffer.from(hmacHeader, "base64");
 
  if (generatedBuffer.length !== headerBuffer.length) {
    return {
      ok: false,
      reason: "hmac_length_mismatch",
    };
  }
 
  const ok = crypto.timingSafeEqual(generatedBuffer, headerBuffer);
 
  return {
    ok,
    reason: ok ? null : "hmac_digest_mismatch",
  };
}
 
export function verifyShopifyHmac(request, rawBody) {
  const result = verifyShopifyHmacResult(request, rawBody);
 
  if (!result.ok) {
    console.error("Shopify webhook HMAC verification failed", {
      reason: result.reason,
    });
  }
 
  return result.ok;
}
 
 