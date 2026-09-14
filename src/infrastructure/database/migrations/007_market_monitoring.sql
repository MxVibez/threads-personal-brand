CREATE TABLE IF NOT EXISTS market_monitor_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL UNIQUE,
  apify_run_id TEXT UNIQUE,
  dataset_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS market_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_code TEXT,
  post_url TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  query TEXT,
  text TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  repost_count INTEGER NOT NULL DEFAULT 0 CHECK (repost_count >= 0),
  quote_count INTEGER NOT NULL DEFAULT 0 CHECK (quote_count >= 0),
  share_count INTEGER NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  is_reply BOOLEAN NOT NULL DEFAULT FALSE,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_posts_username_idx
  ON market_posts (username, posted_at DESC);

CREATE INDEX IF NOT EXISTS market_posts_engagement_idx
  ON market_posts ((like_count + reply_count * 2 + repost_count * 3 + quote_count * 3) DESC);

CREATE TABLE IF NOT EXISTS market_accounts (
  username TEXT PRIMARY KEY,
  post_count INTEGER NOT NULL DEFAULT 0,
  question_count INTEGER NOT NULL DEFAULT 0,
  total_engagement BIGINT NOT NULL DEFAULT 0,
  peak_engagement BIGINT NOT NULL DEFAULT 0,
  score NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_accounts_score_idx
  ON market_accounts (score DESC, last_post_at DESC);
