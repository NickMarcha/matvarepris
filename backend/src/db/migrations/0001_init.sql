CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS chains (
  key text PRIMARY KEY,
  chain_id int NOT NULL UNIQUE,
  display_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id bigserial PRIMARY KEY,
  chain_key text NOT NULL REFERENCES chains(key),
  ean text NOT NULL,
  title text NOT NULL,
  subtitle text,
  category_name text,
  brand text,
  vendor text,
  unit text,
  unit_type text,
  compare_unit text,
  weight numeric,
  image_path text,
  slugified_url text,
  is_local boolean NOT NULL DEFAULT false,
  contains_alcohol boolean NOT NULL DEFAULT false,
  current_price numeric,
  current_price_per_unit numeric,
  current_compare_price_per_unit numeric,
  is_offer boolean NOT NULL DEFAULT false,
  is_out_of_stock boolean NOT NULL DEFAULT false,
  is_for_sale boolean NOT NULL DEFAULT true,
  promotion_name text,
  promotion_id bigint,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_key, ean)
);

CREATE INDEX IF NOT EXISTS idx_products_chain_category ON products (chain_key, category_name);
CREATE INDEX IF NOT EXISTS idx_products_current_price ON products (current_price);
CREATE INDEX IF NOT EXISTS idx_products_compare_price ON products (current_compare_price_per_unit);
CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON products USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS price_history (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  price numeric,
  compare_price_per_unit numeric,
  is_offer boolean,
  is_out_of_stock boolean,
  is_for_sale boolean,
  promotion_name text
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_changed ON price_history (product_id, changed_at DESC);

INSERT INTO chains (key, chain_id, display_name) VALUES
  ('meny', 1300, 'Meny'),
  ('spar', 1210, 'Spar'),
  ('joker', 1220, 'Joker')
ON CONFLICT (key) DO NOTHING;
