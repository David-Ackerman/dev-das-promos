-- True when the admin typed the price (e.g. a coupon price): the automatic
-- price check before publishing must not "correct" it.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS price_from_admin boolean NOT NULL DEFAULT false;
