-- Change feed for GET /api/v1/changes. A trigger stamps a product row
-- whenever something a client cares about changes, so every write path
-- (catalog ingest, nutrition crawl, on-demand detail fetch, diet reclassify)
-- is covered without each one having to remember to log it.
--
-- Why a transaction id and not just the sequence: ingest upserts 20 rows in
-- parallel, each in its own autocommit transaction. Row A can take seq 103,
-- row B seq 105, and B can commit first. A reader ordering by seq alone would
-- return 105, move its cursor past 103, and never see A. Ordering by
-- (change_txid, change_seq) and only returning rows whose transaction is older
-- than every transaction still running (pg_snapshot_xmin) closes that gap:
-- anything still in flight has a txid at or above xmin, so it always lands
-- after the reader's cursor.

CREATE SEQUENCE IF NOT EXISTS product_change_seq;

ALTER TABLE products ADD COLUMN IF NOT EXISTS change_txid xid8;
ALTER TABLE products ADD COLUMN IF NOT EXISTS change_seq bigint;
-- What changed in the row's most recent change only; an earlier change that
-- nobody read yet is overwritten. Clients re-read the whole item anyway.
ALTER TABLE products ADD COLUMN IF NOT EXISTS change_kinds text[];

-- Existing rows enter the feed once, as "new", so a client starting from the
-- beginning gets the whole catalog.
UPDATE products
SET change_txid = pg_current_xact_id(),
    change_seq = nextval('product_change_seq'),
    change_kinds = ARRAY['new'];

CREATE OR REPLACE FUNCTION products_track_change() RETURNS trigger AS $$
DECLARE
  kinds text[] := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    kinds := ARRAY['new'];
  ELSE
    IF NEW.current_price IS DISTINCT FROM OLD.current_price
       OR NEW.current_price_per_unit IS DISTINCT FROM OLD.current_price_per_unit
       OR NEW.current_compare_price_per_unit IS DISTINCT FROM OLD.current_compare_price_per_unit
       OR NEW.original_price IS DISTINCT FROM OLD.original_price
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount THEN
      kinds := kinds || 'price'::text;
    END IF;
    IF NEW.is_offer IS DISTINCT FROM OLD.is_offer
       OR NEW.promotion_name IS DISTINCT FROM OLD.promotion_name THEN
      kinds := kinds || 'offer'::text;
    END IF;
    IF NEW.is_out_of_stock IS DISTINCT FROM OLD.is_out_of_stock
       OR NEW.is_for_sale IS DISTINCT FROM OLD.is_for_sale THEN
      kinds := kinds || 'availability'::text;
    END IF;
    -- nutrition_fetched_at alone moving (a re-crawl that found the same
    -- values) is not a change.
    IF NEW.energy_kj IS DISTINCT FROM OLD.energy_kj
       OR NEW.energy_kcal IS DISTINCT FROM OLD.energy_kcal
       OR NEW.fat_total IS DISTINCT FROM OLD.fat_total
       OR NEW.saturated_fat IS DISTINCT FROM OLD.saturated_fat
       OR NEW.monounsaturated_fat IS DISTINCT FROM OLD.monounsaturated_fat
       OR NEW.polyunsaturated_fat IS DISTINCT FROM OLD.polyunsaturated_fat
       OR NEW.carbs_total IS DISTINCT FROM OLD.carbs_total
       OR NEW.sugars IS DISTINCT FROM OLD.sugars
       OR NEW.sugar_alcohols IS DISTINCT FROM OLD.sugar_alcohols
       OR NEW.starch IS DISTINCT FROM OLD.starch
       OR NEW.fiber IS DISTINCT FROM OLD.fiber
       OR NEW.protein IS DISTINCT FROM OLD.protein
       OR NEW.salt IS DISTINCT FROM OLD.salt
       OR NEW.contains_allergens IS DISTINCT FROM OLD.contains_allergens
       OR NEW.contains_diet_flags IS DISTINCT FROM OLD.contains_diet_flags THEN
      kinds := kinds || 'nutrition'::text;
    END IF;
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.subtitle IS DISTINCT FROM OLD.subtitle
       OR NEW.brand IS DISTINCT FROM OLD.brand
       OR NEW.category_name IS DISTINCT FROM OLD.category_name
       OR NEW.compare_unit IS DISTINCT FROM OLD.compare_unit
       OR NEW.image_path IS DISTINCT FROM OLD.image_path THEN
      kinds := kinds || 'info'::text;
    END IF;
  END IF;

  IF cardinality(kinds) > 0 THEN
    NEW.change_txid := pg_current_xact_id();
    NEW.change_seq := nextval('product_change_seq');
    NEW.change_kinds := kinds;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_track_change ON products;
CREATE TRIGGER products_track_change
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_track_change();

CREATE INDEX IF NOT EXISTS idx_products_change ON products (change_txid, change_seq);
