CREATE TABLE IF NOT EXISTS webhook_events (
    id              BIGSERIAL PRIMARY KEY,
    webhook_id      VARCHAR(255) NOT NULL UNIQUE,
    topic           VARCHAR(100) NOT NULL,
    shopify_id      VARCHAR(255),
    payload_hash    VARCHAR(64) NOT NULL,
    status          VARCHAR(15) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed')),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_topic ON webhook_events (topic, created_at DESC);
