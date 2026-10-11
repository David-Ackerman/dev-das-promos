-- Lowest price we had already seen for the product in the 30 days before the
-- post was suggested (NULL = no price history yet). The admin preview uses it
-- to flag "discounts" on products that were recently cheaper.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS lowest_seen_cents integer;
