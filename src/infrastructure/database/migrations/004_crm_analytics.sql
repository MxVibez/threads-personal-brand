ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

UPDATE leads SET status = 'NEW' WHERE status = 'STARTED';

CREATE INDEX IF NOT EXISTS leads_status_created_idx
  ON leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS leads_telegram_created_idx
  ON leads (telegram_id, created_at DESC);
