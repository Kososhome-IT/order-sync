import { query } from "../../db/client";

export async function getSyncState(entityType) {
  const result = await query(
    "SELECT * FROM sync_state WHERE entity_type = $1",
    [entityType],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getAllSyncStates() {
  const result = await query("SELECT * FROM sync_state ORDER BY entity_type");
  return result.rows.map(mapRow);
}

export async function updateSyncState(
  entityType,
  updates,
) {
  const setClauses = ["updated_at = NOW()"];
  const values = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.lastSyncAt !== undefined) {
    setClauses.push(`last_sync_at = $${paramIndex++}`);
    values.push(updates.lastSyncAt);
  }
  if (updates.lastSuccessfulSyncAt !== undefined) {
    setClauses.push(`last_successful_sync_at = $${paramIndex++}`);
    values.push(updates.lastSuccessfulSyncAt);
  }
  if (updates.nextSyncAt !== undefined) {
    setClauses.push(`next_sync_at = $${paramIndex++}`);
    values.push(updates.nextSyncAt);
  }
  if (updates.syncCursor !== undefined) {
    setClauses.push(`sync_cursor = $${paramIndex++}`);
    values.push(JSON.stringify(updates.syncCursor));
  }
  if (updates.recordsSynced !== undefined) {
    setClauses.push(`records_synced = $${paramIndex++}`);
    values.push(updates.recordsSynced);
  }
  if (updates.recordsFailed !== undefined) {
    setClauses.push(`records_failed = $${paramIndex++}`);
    values.push(updates.recordsFailed);
  }
  if (updates.errorCount24h !== undefined) {
    setClauses.push(`error_count_24h = $${paramIndex++}`);
    values.push(updates.errorCount24h);
  }
  if (updates.isEnabled !== undefined) {
    setClauses.push(`is_enabled = $${paramIndex++}`);
    values.push(updates.isEnabled);
  }
  if (updates.cronExpression !== undefined) {
    setClauses.push(`cron_expression = $${paramIndex++}`);
    values.push(updates.cronExpression);
  }

  values.push(entityType);
  await query(
    `UPDATE sync_state SET ${setClauses.join(", ")} WHERE entity_type = $${paramIndex}`,
    values,
  );
}

export async function markSyncRunning(entityType) {
  const result = await query(
    `UPDATE sync_state SET status = 'running', last_sync_at = NOW(), updated_at = NOW()
     WHERE entity_type = $1 AND status IN ('idle', 'failed')
     RETURNING id`,
    [entityType],
  );
  return (result.rowCount || 0) > 0;
}

export async function markSyncComplete(
  entityType,
  recordsSynced,
  recordsFailed,
) {
  await query(
    `UPDATE sync_state SET
       status = 'idle',
       last_successful_sync_at = NOW(),
       records_synced = $2,
       records_failed = $3,
       updated_at = NOW()
     WHERE entity_type = $1`,
    [entityType, recordsSynced, recordsFailed],
  );
}

export async function markSyncFailed(entityType) {
  await query(
    `UPDATE sync_state SET status = 'failed', updated_at = NOW() WHERE entity_type = $1`,
    [entityType],
  );
}

export async function incrementErrorCount(entityType) {
  const result = await query(
    `UPDATE sync_state SET error_count_24h = error_count_24h + 1, updated_at = NOW()
     WHERE entity_type = $1
     RETURNING error_count_24h`,
    [entityType],
  );
  return result.rows[0]?.error_count_24h || 0;
}

export async function resetErrorCounts() {
  await query("UPDATE sync_state SET error_count_24h = 0, updated_at = NOW()");
}

function mapRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : undefined,
    lastSuccessfulSyncAt: row.last_successful_sync_at
      ? new Date(row.last_successful_sync_at)
      : undefined,
    nextSyncAt: row.next_sync_at ? new Date(row.next_sync_at) : undefined,
    syncCursor: row.sync_cursor,
    status: row.status,
    recordsSynced: row.records_synced,
    recordsFailed: row.records_failed,
    errorCount24h: row.error_count_24h,
    isEnabled: row.is_enabled,
    cronExpression: row.cron_expression,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
