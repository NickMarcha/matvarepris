ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_amount numeric;

CREATE INDEX IF NOT EXISTS idx_products_discount ON products (
  (CASE WHEN original_price > 0 THEN discount_amount / original_price ELSE 0 END)
) WHERE is_offer = true;

ALTER TABLE price_history ADD COLUMN IF NOT EXISTS original_price numeric;
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS discount_amount numeric;
