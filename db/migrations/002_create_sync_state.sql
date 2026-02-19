CREATE TABLE IF NOT EXISTS sync_state (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL UNIQUE CHECK (entity_type IN ('inventory', 'order', 'customer')),
    last_sync_at    TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    next_sync_at    TIMESTAMPTZ,
    sync_cursor     JSONB,
    status          VARCHAR(15) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'failed', 'paused')),
    records_synced  INT DEFAULT 0,
    records_failed  INT DEFAULT 0,
    error_count_24h INT DEFAULT 0,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    cron_expression VARCHAR(50) NOT NULL DEFAULT '*/15 * * * *',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_state (entity_type, cron_expression) VALUES
    ('inventory', '*/15 * * * *'),
    ('order', '* * * * *'),
    ('customer', '*/30 * * * *')
ON CONFLICT (entity_type) DO NOTHING;
