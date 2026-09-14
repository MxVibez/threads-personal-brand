ALTER TABLE market_posts
  ADD COLUMN IF NOT EXISTS source_market TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_market IN ('international', 'russian', 'unknown'));

CREATE INDEX IF NOT EXISTS market_posts_source_market_idx
  ON market_posts (source_market, opportunity_score DESC, posted_at DESC NULLS LAST)
  WHERE excluded_reason IS NULL;
