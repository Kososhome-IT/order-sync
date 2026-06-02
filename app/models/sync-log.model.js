import { query } from "../../db/client";

export async function createSyncLog(input) {
  const result = await query(
    `INSERT INTO sync_logs (sync_run_id, entity_type, direction, status, shopify_id, netsuite_id, operation, request_payload, response_payload, error_message, error_code, retry_count, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.syncRunId,
      input.entityType,
      input.direction,
      input.status || "pending",
      input.shopifyId,
      input.netsuiteId,
      input.operation,
      input.requestPayload ? JSON.stringify(input.requestPayload) : null,
      input.responsePayload ? JSON.stringify(input.responsePayload) : null,
      input.errorMessage,
      input.errorCode,
      input.retryCount || 0,
      input.durationMs,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function updateSyncLog(
  id,
  updates,
) {
  const setClauses = ["updated_at = NOW()"];
  const values = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.responsePayload !== undefined) {
    setClauses.push(`response_payload = $${paramIndex++}`);
    values.push(JSON.stringify(updates.responsePayload));
  }
  if (updates.errorMessage !== undefined) {
    setClauses.push(`error_message = $${paramIndex++}`);
    values.push(updates.errorMessage);
  }
  if (updates.errorCode !== undefined) {
    setClauses.push(`error_code = $${paramIndex++}`);
    values.push(updates.errorCode);
  }
  if (updates.retryCount !== undefined) {
    setClauses.push(`retry_count = $${paramIndex++}`);
    values.push(updates.retryCount);
  }
  if (updates.durationMs !== undefined) {
    setClauses.push(`duration_ms = $${paramIndex++}`);
    values.push(updates.durationMs);
  }

  values.push(id);
  await query(`UPDATE sync_logs SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values);
}

export async function getSyncLogs(filter) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (filter.entityType) {
    conditions.push(`entity_type = $${paramIndex++}`);
    values.push(filter.entityType);
  }
  if (filter.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(filter.status);
  }
  if (filter.direction) {
    conditions.push(`direction = $${paramIndex++}`);
    values.push(filter.direction);
  }
  if (filter.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(filter.startDate);
  }
  if (filter.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(filter.endDate);
  }
  if (filter.search) {
    conditions.push(`(shopify_id ILIKE $${paramIndex} OR netsuite_id ILIKE $${paramIndex})`);
    values.push(`%${filter.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const [logsResult, countResult] = await Promise.all([
    query(
      `SELECT * FROM sync_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...values, pageSize, offset],
    ),
    query(`SELECT COUNT(*) as total FROM sync_logs ${whereClause}`, values),
  ]);

  return {
    logs: logsResult.rows.map(mapRow),
    total: parseInt(countResult.rows[0].total, 10),
  };
}

export async function getRecentSyncLogs(limit = 20) {
  const result = await query(
    "SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return result.rows.map(mapRow);
}

export async function getSyncRunLogs(syncRunId) {
  const result = await query(
    "SELECT * FROM sync_logs WHERE sync_run_id = $1 ORDER BY created_at",
    [syncRunId],
  );
  return result.rows.map(mapRow);
}

export async function cleanupOldLogs(daysToKeep = 30) {
  const result = await query(
    "DELETE FROM sync_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1",
    [daysToKeep],
  );
  return result.rowCount || 0;
}

function mapRow(row) {
  return {
    id: row.id,
    syncRunId: row.sync_run_id,
    entityType: row.entity_type,
    direction: row.direction,
    status: row.status,
    shopifyId: row.shopify_id,
    netsuiteId: row.netsuite_id,
    operation: row.operation,
    requestPayload: row.request_payload,
    responsePayload: row.response_payload,
    errorMessage: row.error_message,
    errorCode: row.error_code,
    retryCount: row.retry_count,
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
