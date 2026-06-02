CREATE TABLE IF NOT EXISTS field_mappings (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('inventory', 'order', 'customer')),
    direction       VARCHAR(15) NOT NULL CHECK (direction IN ('ns_to_shopify', 'shopify_to_ns', 'bidirectional')),
    netsuite_field  VARCHAR(255) NOT NULL,
    shopify_field   VARCHAR(255) NOT NULL,
    transform_type  VARCHAR(20) DEFAULT 'direct' CHECK (transform_type IN ('direct', 'template', 'lookup', 'formula', 'custom')),
    transform_config JSONB,
    is_required     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, direction, netsuite_field, shopify_field)
);
