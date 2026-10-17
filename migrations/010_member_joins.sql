-- Who joined the Telegram groups through which invite link, and when they left
-- (7-day retention per link). The user is stored only as a salted hash.
CREATE TABLE IF NOT EXISTS member_joins (
  id         bigserial PRIMARY KEY,
  chat_id    text NOT NULL,
  user_hash  text NOT NULL,
  link_name  text NOT NULL DEFAULT '',    -- invite link name; '' = public link / added by an admin
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz
);
CREATE INDEX IF NOT EXISTS member_joins_user_idx ON member_joins (chat_id, user_hash);
CREATE INDEX IF NOT EXISTS member_joins_time_idx ON member_joins (joined_at);
