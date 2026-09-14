CREATE TABLE IF NOT EXISTS miniapp_access (
  telegram_id BIGINT PRIMARY KEY CHECK (telegram_id > 0),
  role TEXT NOT NULL DEFAULT 'TESTER' CHECK (role IN ('TESTER')),
  display_name TEXT,
  username TEXT,
  granted_by_telegram_id BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS miniapp_access_active_idx
  ON miniapp_access (active, created_at DESC);

CREATE TABLE IF NOT EXISTS miniapp_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL CHECK (telegram_id > 0),
  display_name TEXT NOT NULL,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by_telegram_id BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS miniapp_access_requests_pending_idx
  ON miniapp_access_requests (telegram_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS miniapp_access_requests_status_idx
  ON miniapp_access_requests (status, requested_at ASC);
