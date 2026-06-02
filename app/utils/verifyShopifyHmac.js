import crypto from "crypto";

export function verifyShopifyHmac(request, rawBody) {
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

  if (!hmacHeader) {
    console.error("❌ Missing X-Shopify-Hmac-Sha256 header");
    return false;
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("❌ SHOPIFY_API_SECRET not set");
    return false;
  }

  const generatedHmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedHmac, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
  } catch (err) {
    return false;
  }
}
