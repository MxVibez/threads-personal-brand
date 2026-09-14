ALTER TABLE market_posts
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER NOT NULL DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS reach_score INTEGER NOT NULL DEFAULT 0 CHECK (reach_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS commercial_score INTEGER NOT NULL DEFAULT 0 CHECK (commercial_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS opportunity_score INTEGER NOT NULL DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_angle TEXT,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT,
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS market_posts_opportunity_idx
  ON market_posts (opportunity_score DESC, posted_at DESC NULLS LAST)
  WHERE excluded_reason IS NULL;
