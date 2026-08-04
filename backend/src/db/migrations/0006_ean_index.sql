-- Enables efficient GROUP BY ean / DISTINCT ON (ean) for the cross-chain
-- grouped product view (GET /api/products/grouped). Not unique — the same
-- ean legitimately repeats across chain_key values (that's the whole
-- point); UNIQUE (chain_key, ean) already guarantees per-chain uniqueness.
CREATE INDEX IF NOT EXISTS idx_products_ean ON products (ean);
