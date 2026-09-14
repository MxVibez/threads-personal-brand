ALTER TABLE publication_jobs
  DROP CONSTRAINT IF EXISTS publication_jobs_status_check;

ALTER TABLE publication_jobs
  ADD CONSTRAINT publication_jobs_status_check CHECK (status IN (
    'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED',
    'PARTIAL_FAILED', 'NEEDS_REVIEW', 'CANCELLED'
  ));

ALTER TABLE drafts
  DROP CONSTRAINT IF EXISTS drafts_status_check;

ALTER TABLE drafts
  ADD CONSTRAINT drafts_status_check CHECK (status IN (
    'WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHING',
    'PUBLISHED', 'FAILED', 'PARTIAL_FAILED', 'CANCELLED'
  ));
