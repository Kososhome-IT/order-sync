import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { syncEngine } from "../services/sync/sync.engine";
import { syncTriggerSchema } from "../utils/validators";
import { QUEUE_NAMES } from "../utils/constants";

export async function action({ request }) {
  await authenticate.admin(request);

  const body = await request.json();
  const parsed = syncTriggerSchema.safeParse(body);

  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { entityType, mode } = parsed.data;

  try {
    const jobData = await syncEngine.triggerSync(entityType, mode, "manual");

    const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });

    const queueName =
      entityType === "inventory"
        ? QUEUE_NAMES.INVENTORY_SYNC
        : entityType === "order"
          ? QUEUE_NAMES.ORDER_SYNC
          : QUEUE_NAMES.CUSTOMER_SYNC;

    const queue = new Queue(queueName, { connection });
    await queue.add(`manual-${entityType}-${Date.now()}`, jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });

    await connection.quit();

    return json({
      success: true,
      syncRunId: jobData.syncRunId,
      message: `${entityType} ${mode} sync triggered`,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Failed to trigger sync" },
      { status: 400 },
    );
  }
}
