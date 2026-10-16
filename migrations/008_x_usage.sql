-- Every paid X API call the bot made (X_MODE=thread), so it stays inside
-- X_MONTHLY_BUDGET_USD and the per-day / per-store limits.
CREATE TABLE IF NOT EXISTS x_usage (
  id          serial PRIMARY KEY,
  post_id     integer REFERENCES posts(id),
  kind        text NOT NULL,              -- 'post' | 'reply'
  cost_usd    numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x_usage_time_idx ON x_usage (created_at);
