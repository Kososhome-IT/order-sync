import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncEngine } from "../services/sync/sync.engine";
import { getPendingDLQCount } from "../models/dead-letter.model";

export async function loader({ request }) {
  await authenticate.admin(request);

  const status = await syncEngine.getSyncStatus();
  const pendingDLQ = await getPendingDLQCount();

  return json({
    ...status,
    deadLetterQueue: { pendingCount: pendingDLQ },
    timestamp: new Date().toISOString(),
  });
}
