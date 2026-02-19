import pg from "pg";
import {
  DEFAULT_INVENTORY_MAPPINGS,
  DEFAULT_ORDER_MAPPINGS,
  DEFAULT_CUSTOMER_MAPPINGS,
} from "../app/types/mapping.types";

async function seed() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/shopify_netsuite",
  });

  const client = await pool.connect();

  try {
    console.warn("Seeding default field mappings...");

    const insertMapping = async (
      entityType,
      direction,
      mappings,
    ) => {
      for (const m of mappings) {
        await client.query(
          `INSERT INTO field_mappings (entity_type, direction, netsuite_field, shopify_field, transform_type, transform_config, is_required, is_active, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (entity_type, direction, netsuite_field, shopify_field) DO NOTHING`,
          [
            entityType,
            direction,
            m.netsuiteField,
            m.shopifyField,
            m.transformType,
            m.transformConfig ? JSON.stringify(m.transformConfig) : null,
            m.isRequired,
            m.isActive,
            m.sortOrder,
          ],
        );
      }
    };

    await insertMapping("inventory", "ns_to_shopify", DEFAULT_INVENTORY_MAPPINGS);
    await insertMapping("order", "shopify_to_ns", DEFAULT_ORDER_MAPPINGS);
    await insertMapping("customer", "bidirectional", DEFAULT_CUSTOMER_MAPPINGS);

    console.warn("Seeding complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
