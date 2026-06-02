import { query, transaction } from "../../db/client";

export async function getFieldMappings(
  entityType,
  direction,
) {
  let sql = "SELECT * FROM field_mappings WHERE entity_type = $1 AND is_active = TRUE";
  const params = [entityType];

  if (direction) {
    sql += " AND (direction = $2 OR direction = 'bidirectional')";
    params.push(direction);
  }

  sql += " ORDER BY sort_order ASC";

  const result = await query(sql, params);
  return result.rows.map(mapRow);
}

export async function getAllFieldMappings(entityType) {
  const result = await query(
    "SELECT * FROM field_mappings WHERE entity_type = $1 ORDER BY sort_order ASC",
    [entityType],
  );
  return result.rows.map(mapRow);
}

export async function createFieldMapping(input) {
  const result = await query(
    `INSERT INTO field_mappings (entity_type, direction, netsuite_field, shopify_field, transform_type, transform_config, is_required, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (entity_type, direction, netsuite_field, shopify_field)
     DO UPDATE SET transform_type = $5, transform_config = $6, is_required = $7, is_active = $8, sort_order = $9, updated_at = NOW()
     RETURNING *`,
    [
      input.entityType,
      input.direction,
      input.netsuiteField,
      input.shopifyField,
      input.transformType || "direct",
      input.transformConfig ? JSON.stringify(input.transformConfig) : null,
      input.isRequired ?? false,
      input.isActive ?? true,
      input.sortOrder ?? 0,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function updateFieldMapping(
  id,
  updates,
) {
  const setClauses = ["updated_at = NOW()"];
  const values = [];
  let paramIndex = 1;

  if (updates.netsuiteField !== undefined) {
    setClauses.push(`netsuite_field = $${paramIndex++}`);
    values.push(updates.netsuiteField);
  }
  if (updates.shopifyField !== undefined) {
    setClauses.push(`shopify_field = $${paramIndex++}`);
    values.push(updates.shopifyField);
  }
  if (updates.transformType !== undefined) {
    setClauses.push(`transform_type = $${paramIndex++}`);
    values.push(updates.transformType);
  }
  if (updates.transformConfig !== undefined) {
    setClauses.push(`transform_config = $${paramIndex++}`);
    values.push(JSON.stringify(updates.transformConfig));
  }
  if (updates.isRequired !== undefined) {
    setClauses.push(`is_required = $${paramIndex++}`);
    values.push(updates.isRequired);
  }
  if (updates.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive);
  }
  if (updates.sortOrder !== undefined) {
    setClauses.push(`sort_order = $${paramIndex++}`);
    values.push(updates.sortOrder);
  }

  values.push(id);
  await query(`UPDATE field_mappings SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values);
}

export async function deleteFieldMapping(id) {
  await query("DELETE FROM field_mappings WHERE id = $1", [id]);
}

export async function replaceFieldMappings(
  entityType,
  direction,
  mappings,
) {
  return transaction(async (client) => {
    await client.query(
      "DELETE FROM field_mappings WHERE entity_type = $1 AND direction = $2",
      [entityType, direction],
    );

    const results = [];
    for (const m of mappings) {
      const result = await client.query(
        `INSERT INTO field_mappings (entity_type, direction, netsuite_field, shopify_field, transform_type, transform_config, is_required, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          entityType,
          direction,
          m.netsuiteField,
          m.shopifyField,
          m.transformType || "direct",
          m.transformConfig ? JSON.stringify(m.transformConfig) : null,
          m.isRequired ?? false,
          m.isActive ?? true,
          m.sortOrder ?? 0,
        ],
      );
      results.push(mapRow(result.rows[0]));
    }
    return results;
  });
}

function mapRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    direction: row.direction,
    netsuiteField: row.netsuite_field,
    shopifyField: row.shopify_field,
    transformType: row.transform_type,
    transformConfig: row.transform_config,
    isRequired: row.is_required,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
