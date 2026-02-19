CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    operation       VARCHAR(10) NOT NULL,
    direction       VARCHAR(15) NOT NULL,
    original_job_id VARCHAR(255),
    payload         JSONB NOT NULL,
    error_message   TEXT NOT NULL,
    error_stack     TEXT,
    retry_count     INT NOT NULL DEFAULT 0,
    max_retries     INT NOT NULL DEFAULT 5,
    status          VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'resolved', 'abandoned')),
    resolved_at     TIMESTAMPTZ,
    resolved_by     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dlq_status ON dead_letter_queue (status, entity_type);
