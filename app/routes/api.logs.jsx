import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSyncLogs } from "../models/sync-log.model";
import { getDeadLetterItems } from "../models/dead-letter.model";
import { logFilterSchema } from "../utils/validators";

export async function loader({ request }) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);

  const isDlq = url.searchParams.get("dlq") === "true";

  if (isDlq) {
    const dlqResult = await getDeadLetterItems({
      status: params.status || undefined,
      entityType: params.entityType || undefined,
      page: params.page ? parseInt(params.page) : 1,
      pageSize: params.pageSize ? parseInt(params.pageSize) : 50,
    });

    return json({
      type: "dlq",
      items: dlqResult.items,
      total: dlqResult.total,
      page: parseInt(params.page || "1"),
      pageSize: parseInt(params.pageSize || "50"),
    });
  }

  const parsed = logFilterSchema.safeParse(params);
  if (!parsed.success) {
    return json({ error: "Invalid parameters", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await getSyncLogs(parsed.data);

  return json({
    type: "logs",
    logs: result.logs,
    total: result.total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
}
