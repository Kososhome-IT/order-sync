CREATE TABLE IF NOT EXISTS sync_logs (
    id              BIGSERIAL PRIMARY KEY,
    sync_run_id     UUID NOT NULL,
    entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('inventory', 'order', 'customer')),
    direction       VARCHAR(15) NOT NULL CHECK (direction IN ('ns_to_shopify', 'shopify_to_ns')),
    status          VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'skipped')),
    shopify_id      VARCHAR(255),
    netsuite_id     VARCHAR(255),
    operation       VARCHAR(10) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    request_payload JSONB,
    response_payload JSONB,
    error_message   TEXT,
    error_code      VARCHAR(50),
    retry_count     INT NOT NULL DEFAULT 0,
    duration_ms     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_entity_status ON sync_logs (entity_type, status);
CREATE INDEX idx_sync_logs_sync_run ON sync_logs (sync_run_id);
CREATE INDEX idx_sync_logs_created_at ON sync_logs (created_at DESC);
CREATE INDEX idx_sync_logs_shopify_id ON sync_logs (shopify_id) WHERE shopify_id IS NOT NULL;
CREATE INDEX idx_sync_logs_netsuite_id ON sync_logs (netsuite_id) WHERE netsuite_id IS NOT NULL;
