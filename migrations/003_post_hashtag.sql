-- One brand/product hashtag suggested by the AI (without "#", e.g. "Kindle"),
-- added to X posts next to #publi when it fits. NULL = none.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtag text;
