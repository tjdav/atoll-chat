CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT NOT NULL,
    window_start DATETIME NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
