CREATE TABLE IF NOT EXISTS netsuite_config (
    id              SERIAL PRIMARY KEY,
    account_id      VARCHAR(50) NOT NULL,
    client_id       TEXT NOT NULL,
    client_secret_enc TEXT NOT NULL,
    private_key_enc TEXT NOT NULL,
    certificate_id  VARCHAR(255) NOT NULL,
    restlet_urls    JSONB NOT NULL DEFAULT '{}',
    token_cache     JSONB,
    scopes          TEXT[] DEFAULT ARRAY['rest_webservices', 'restlets'],
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_at    TIMESTAMPTZ,
    last_test_result VARCHAR(10),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
