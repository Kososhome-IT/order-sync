import { query } from "../../db/client";

export async function addToDeadLetterQueue(input) {
  const result = await query(
    `INSERT INTO dead_letter_queue (entity_type, operation, direction, original_job_id, payload, error_message, error_stack, retry_count, max_retries)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.entityType,
      input.operation,
      input.direction,
      input.originalJobId,
      JSON.stringify(input.payload),
      input.errorMessage,
      input.errorStack,
      input.retryCount,
      input.maxRetries || 5,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function getDeadLetterItems(
  options = {},
) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (options.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(options.status);
  }
  if (options.entityType) {
    conditions.push(`entity_type = $${paramIndex++}`);
    values.push(options.entityType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const [itemsResult, countResult] = await Promise.all([
    query(
      `SELECT * FROM dead_letter_queue ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...values, pageSize, offset],
    ),
    query(`SELECT COUNT(*) as total FROM dead_letter_queue ${whereClause}`, values),
  ]);

  return {
    items: itemsResult.rows.map(mapRow),
    total: parseInt(countResult.rows[0].total, 10),
  };
}

export async function markDLQRetrying(id) {
  await query(
    `UPDATE dead_letter_queue SET status = 'retrying', retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function markDLQResolved(id, resolvedBy = "auto") {
  await query(
    `UPDATE dead_letter_queue SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, updated_at = NOW() WHERE id = $1`,
    [id, resolvedBy],
  );
}

export async function markDLQAbandoned(id, resolvedBy = "admin") {
  await query(
    `UPDATE dead_letter_queue SET status = 'abandoned', resolved_at = NOW(), resolved_by = $2, updated_at = NOW() WHERE id = $1`,
    [id, resolvedBy],
  );
}

export async function getPendingDLQCount() {
  const result = await query(
    "SELECT COUNT(*) as count FROM dead_letter_queue WHERE status = 'pending'",
  );
  return parseInt(result.rows[0].count, 10);
}

export async function cleanupResolvedDLQ(daysToKeep = 30) {
  const result = await query(
    "DELETE FROM dead_letter_queue WHERE status IN ('resolved', 'abandoned') AND resolved_at < NOW() - INTERVAL '1 day' * $1",
    [daysToKeep],
  );
  return result.rowCount || 0;
}

function mapRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    operation: row.operation,
    direction: row.direction,
    originalJobId: row.original_job_id,
    payload: row.payload,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    status: row.status,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolvedBy: row.resolved_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
