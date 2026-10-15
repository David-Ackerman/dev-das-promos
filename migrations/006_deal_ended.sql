-- Set when a published deal sold out or got pricier; the Telegram group
-- messages were edited with deal_note as a banner.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deal_ended_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deal_note text;
