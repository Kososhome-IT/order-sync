import { query } from "../../db/client";

export async function findByShopifyId(
  entityType,
  shopifyId,
) {
  const result = await query(
    "SELECT * FROM entity_mappings WHERE entity_type = $1 AND shopify_id = $2",
    [entityType, shopifyId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function findByNetsuiteId(
  entityType,
  netsuiteId,
) {
  const result = await query(
    "SELECT * FROM entity_mappings WHERE entity_type = $1 AND netsuite_id = $2",
    [entityType, netsuiteId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function upsertEntityMapping(input) {
  const result = await query(
    `INSERT INTO entity_mappings (entity_type, shopify_id, netsuite_id, shopify_hash, netsuite_hash, last_synced_at, sync_direction, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
     ON CONFLICT (entity_type, netsuite_id)
     DO UPDATE SET shopify_id = $2, shopify_hash = $4, netsuite_hash = $5, last_synced_at = NOW(), sync_direction = $6, metadata = COALESCE($7, entity_mappings.metadata), updated_at = NOW()
     RETURNING *`,
    [
      input.entityType,
      input.shopifyId,
      input.netsuiteId,
      input.shopifyHash,
      input.netsuiteHash,
      input.syncDirection,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function updateHashes(
  id,
  shopifyHash,
  netsuiteHash,
) {
  const setClauses = ["updated_at = NOW()", "last_synced_at = NOW()"];
  const values = [];
  let paramIndex = 1;

  if (shopifyHash !== undefined) {
    setClauses.push(`shopify_hash = $${paramIndex++}`);
    values.push(shopifyHash);
  }
  if (netsuiteHash !== undefined) {
    setClauses.push(`netsuite_hash = $${paramIndex++}`);
    values.push(netsuiteHash);
  }

  values.push(id);
  await query(
    `UPDATE entity_mappings SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
    values,
  );
}

export async function getAllMappings(entityType) {
  const result = await query(
    "SELECT * FROM entity_mappings WHERE entity_type = $1 ORDER BY created_at DESC",
    [entityType],
  );
  return result.rows.map(mapRow);
}

export async function deleteMapping(id) {
  await query("DELETE FROM entity_mappings WHERE id = $1", [id]);
}

export async function getMappingCount(entityType) {
  const result = await query(
    "SELECT COUNT(*) as count FROM entity_mappings WHERE entity_type = $1",
    [entityType],
  );
  return parseInt(result.rows[0].count, 10);
}

function mapRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    shopifyId: row.shopify_id,
    netsuiteId: row.netsuite_id,
    shopifyHash: row.shopify_hash,
    netsuiteHash: row.netsuite_hash,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : undefined,
    syncDirection: row.sync_direction,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
