ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS analysis JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE publication_jobs
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS publication_jobs_scheduled_idx
  ON publication_jobs (status, scheduled_at);
