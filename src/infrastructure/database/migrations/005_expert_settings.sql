ALTER TABLE experts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Krasnoyarsk',
  ADD COLUMN IF NOT EXISTS daily_publication_limit SMALLINT NOT NULL DEFAULT 5
    CHECK (daily_publication_limit BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS voice_profile JSONB NOT NULL DEFAULT
    '{"description":"","avoid":"","examples":[]}'::jsonb;

