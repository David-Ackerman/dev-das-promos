-- A post can use its own photo instead of the store's: an AI scene made when
-- the store photo has a plain white background or too much text. The file
-- lives in Telegram (image_file_id) and is served by the Worker at /img/<id>,
-- which is what posts.image_url points to. NULL = use products.image_url.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_file_id text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_source text;   -- 'generated' | NULL (store photo)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_note text;     -- why, shown in the preview
