-- Visits to the public page per day and source (?src=x, ig, …; '' = direct),
-- so /stats shows which bio link brings people. Robots are not counted.
CREATE TABLE IF NOT EXISTS site_views (
  day     date NOT NULL,
  source  text NOT NULL DEFAULT '',
  views   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);
