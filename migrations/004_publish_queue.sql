-- Publishing queue: an approved post waits in status 'queued' until scheduled_at.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
CREATE INDEX IF NOT EXISTS posts_queue_idx ON posts (status, scheduled_at);
