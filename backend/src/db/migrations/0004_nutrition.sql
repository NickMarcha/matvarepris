-- Nutrition facts per 100g/ml, matching the labels shown on the site's
-- "Næringsinnhold" panel. NULL means not yet crawled OR the source simply
-- doesn't report that field for this product (e.g. mono/poly-unsaturated
-- fat only appears on fat-relevant products like oils).
ALTER TABLE products ADD COLUMN IF NOT EXISTS energy_kj numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS energy_kcal numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fat_total numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS saturated_fat numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS monounsaturated_fat numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS polyunsaturated_fat numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS carbs_total numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sugars numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sugar_alcohols numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS starch numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiber numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS protein numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS salt numeric;

-- Flattened from product_details.allergens where code = 'JA', so the main
-- product list can filter without a join.
ALTER TABLE products ADD COLUMN IF NOT EXISTS contains_allergens text[];

-- NULL = never crawled (the nutrition background crawler's backlog queue).
-- Also set by the on-demand product-detail route, so opening a product's
-- modal counts as "crawled" and the background job won't re-fetch it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS nutrition_fetched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_products_nutrition_backlog ON products (id) WHERE nutrition_fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_carbs ON products (carbs_total);
CREATE INDEX IF NOT EXISTS idx_products_protein ON products (protein);
CREATE INDEX IF NOT EXISTS idx_products_energy_kcal ON products (energy_kcal);
CREATE INDEX IF NOT EXISTS idx_products_fiber ON products (fiber);
CREATE INDEX IF NOT EXISTS idx_products_allergens ON products USING gin (contains_allergens);
