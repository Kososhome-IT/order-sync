import { authenticate } from "../shopify.server";
import { json } from "../utils/jsonResponse";
import { runOrderResync } from "../services/shopify/order-resync.service";

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, { status: 405 });
  }
  await authenticate.admin(request);
  try {
    const summary = await runOrderResync();
    return json({ success: true, summary });
  } catch (error) {
    const status = error.message.includes("already running") ? 409 : 500;
    console.error("[ORDER_RESYNC] Dashboard request failed", JSON.stringify({
      timestamp: new Date().toISOString(), status, error: error.message, stack: error.stack,
    }));
    return json({ success: false, error: error.message }, { status });
  }
}
