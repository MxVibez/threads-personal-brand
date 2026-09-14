ALTER TABLE publication_segments DROP CONSTRAINT publication_segments_status_check;
ALTER TABLE publication_segments ADD CONSTRAINT publication_segments_status_check
  CHECK (status IN ('PENDING', 'CONTAINER_CREATED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'NEEDS_REVIEW'));

-- Existing jobs were approved during the pilot and must never become live after a config change.
ALTER TABLE publication_jobs ADD COLUMN dry_run BOOLEAN NOT NULL DEFAULT TRUE;
