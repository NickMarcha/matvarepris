-- Prices people report from their own receipts and shelves, through a client
-- app (Susdi) holding a key from REPORT_API_KEYS. Each report is kept as it
-- came in, so one reporter's reports can be deleted on request. The current
-- price per (chain, EAN) is the newest report, written into `products` like
-- the other sources so search, history and /changes see it.
--
-- `reporter` is an opaque id chosen by the client (Susdi sends an HMAC of
-- the user id), never a name. Only the chain is stored, not the store, so a
-- report doesn't say where someone shops.
CREATE TABLE IF NOT EXISTS reported_prices (
  id bigserial PRIMARY KEY,
  ean text NOT NULL,
  chain_key text NOT NULL REFERENCES chains(key),
  price numeric NOT NULL,
  observed_on date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'shelf')),
  client text NOT NULL,
  reporter text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reported_prices_offer ON reported_prices (chain_key, ean, observed_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reported_prices_reporter ON reported_prices (client, reporter);

-- What a barcode is when no chain we read sells it (Coop's own brands,
-- imports): looked up on Kassalapp, then Open Food Facts, and cached here.
-- found = false caches "nobody knows it" for a shorter time.
CREATE TABLE IF NOT EXISTS catalog_products (
  ean text PRIMARY KEY,
  found boolean NOT NULL,
  source text,
  title text,
  brand text,
  quantity_text text,
  content_amount numeric,
  content_unit text,
  image_url text,
  nutrition jsonb,
  vegan boolean,
  vegetarian boolean,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Chains that only get prices from reports. Kassalapp's code map already
-- uses these keys; if Kassalapp starts updating one again its prices take
-- the row over, since fresh store-wide prices beat occasional reports.
INSERT INTO chains (key, chain_id, display_name, source) VALUES
  ('kiwi', NULL, 'Kiwi', 'reported'),
  ('rema', NULL, 'Rema 1000', 'reported'),
  ('extra', NULL, 'Coop Extra', 'reported'),
  ('prix', NULL, 'Coop Prix', 'reported'),
  ('mega', NULL, 'Coop Mega', 'reported'),
  ('obs', NULL, 'Coop Obs', 'reported'),
  ('coopmarked', NULL, 'Coop Marked', 'reported')
ON CONFLICT (key) DO NOTHING;
