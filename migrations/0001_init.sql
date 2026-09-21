-- Single table with a discriminator column keeps display / exposure / click
-- events queryable together while staying trivial to extend with new types.
CREATE TABLE IF NOT EXISTS log_record (
    id              BIGSERIAL PRIMARY KEY,
    type            TEXT        NOT NULL CHECK (type IN ('display', 'exposure', 'click')),
    ip              TEXT,
    location        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    timezone        TEXT,
    language        TEXT,
    user_agent      TEXT,
    referer         TEXT,
    params          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    event_timestamp BIGINT      NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Typical analytics access pattern: newest events of a given type first.
CREATE INDEX IF NOT EXISTS idx_log_record_type_created_at ON log_record (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_record_created_at ON log_record (created_at DESC);
