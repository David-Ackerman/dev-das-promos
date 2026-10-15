-- Weekly "Top 10" messages. status: pending -> sent | declined.
CREATE TABLE IF NOT EXISTS roundups (
  id                  serial PRIMARY KEY,
  post_ids            integer[] NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  preview_chat_id     text,
  preview_message_id  bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
