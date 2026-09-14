CREATE TABLE IF NOT EXISTS threads_analytics_cache (
  account_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS threads_analytics_cache_refreshed_idx
  ON threads_analytics_cache (refreshed_at DESC);
