-- Coupons the admin sends (/cupom) go through the same approve / queue / publish
-- flow as deals. kind = 'deal' | 'coupon'. A coupon's details (code, discount,
-- minimum, cap, rules) live in `coupon`; `valid_until` is when it stops working
-- (null = unknown), used to stop expired coupons and flag them in the groups.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'deal';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS coupon jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS valid_until timestamptz;
