CREATE TABLE IF NOT EXISTS entity_mappings (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('inventory_item', 'order', 'customer', 'location')),
    shopify_id      VARCHAR(255) NOT NULL,
    netsuite_id     VARCHAR(255) NOT NULL,
    shopify_hash    VARCHAR(64),
    netsuite_hash   VARCHAR(64),
    last_synced_at  TIMESTAMPTZ,
    sync_direction  VARCHAR(15),
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, shopify_id),
    UNIQUE (entity_type, netsuite_id)
);

CREATE INDEX idx_entity_mappings_lookup ON entity_mappings (entity_type, shopify_id, netsuite_id);
