-- Initial schema. Migrations in this folder are applied once, in name order,
-- and are NEVER rolled back. Only add new files; never edit an applied one.
-- Never DROP or TRUNCATE here (a test enforces it) so no data is ever lost.

CREATE TABLE IF NOT EXISTS products (
  id            serial PRIMARY KEY,
  marketplace   text NOT NULL,              -- 'amazon' | 'shopee'
  external_id   text NOT NULL,              -- ASIN / Shopee itemId
  title         text NOT NULL,
  image_url     text,
  product_url   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketplace, external_id)
);

-- Every price we ever saw, so we can later spot fake "discounts".
CREATE TABLE IF NOT EXISTS price_snapshots (
  id                    bigserial PRIMARY KEY,
  product_id            integer NOT NULL REFERENCES products(id),
  price_cents           integer NOT NULL,
  original_price_cents  integer,
  captured_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_snapshots_product_idx ON price_snapshots (product_id, captured_at);

-- One row per suggested post. status:
-- pending -> (approved) publishing -> published | partial | failed
-- pending -> declined | expired
CREATE TABLE IF NOT EXISTS posts (
  id                    serial PRIMARY KEY,
  product_id            integer NOT NULL REFERENCES products(id),
  ref                   text NOT NULL UNIQUE, -- sent to the marketplace as sub-id
  status                text NOT NULL DEFAULT 'pending',
  price_cents           integer NOT NULL,
  original_price_cents  integer,
  discount_pct          integer NOT NULL DEFAULT 0,
  commission_rate       numeric,
  affiliate_url         text NOT NULL,
  caption               text NOT NULL,        -- AI text for Telegram/WhatsApp
  caption_short         text NOT NULL,        -- AI text for X
  ai_model              text,
  preview_chat_id       text,
  preview_message_id    bigint,
  preview_has_photo     boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  published_at          timestamptz
);
CREATE INDEX IF NOT EXISTS posts_status_idx ON posts (status, created_at);
CREATE INDEX IF NOT EXISTS posts_product_idx ON posts (product_id, created_at);

-- Our own short links: one per post + channel + destination group.
CREATE TABLE IF NOT EXISTS links (
  code        text PRIMARY KEY,
  post_id     integer NOT NULL REFERENCES posts(id),
  channel     text NOT NULL,                  -- 'telegram' | 'whatsapp' | 'x'
  target      text NOT NULL DEFAULT '',       -- group/chat id, '' when not applicable
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, channel, target)
);

CREATE TABLE IF NOT EXISTS clicks (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL REFERENCES links(code),
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  is_bot      boolean NOT NULL DEFAULT false,  -- link-preview crawlers etc.
  country     text,
  user_agent  text,
  referer     text,
  ip_hash     text
);
CREATE INDEX IF NOT EXISTS clicks_code_idx ON clicks (code, clicked_at);
CREATE INDEX IF NOT EXISTS clicks_time_idx ON clicks (clicked_at);

-- Result of each delivery attempt.
CREATE TABLE IF NOT EXISTS publications (
  id           serial PRIMARY KEY,
  post_id      integer NOT NULL REFERENCES posts(id),
  channel      text NOT NULL,
  target       text NOT NULL DEFAULT '',
  status       text NOT NULL,                 -- 'sent' | 'failed' | 'manual'
  external_id  text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publications_post_idx ON publications (post_id);
