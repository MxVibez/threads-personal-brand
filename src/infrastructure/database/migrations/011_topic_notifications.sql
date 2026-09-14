ALTER TABLE market_posts
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS market_posts_unnotified_idx
  ON market_posts (first_seen_at DESC)
  WHERE notified_at IS NULL;
