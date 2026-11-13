-- Chains can now come from two places: NorgesGruppen's own search API
-- (ngdata: meny, spar, joker) or Kassalapp's price API (oda, bunnpris, ...).
-- Kassalapp chains have no ngdata chainId, so chain_id becomes optional;
-- UNIQUE still holds for the ones that have it (NULLs don't collide).
-- Kassalapp chain rows are inserted by the ingest the first time a store
-- shows up, so a store that never has fresh prices never gets a filter chip.
ALTER TABLE chains ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ngdata';
ALTER TABLE chains ALTER COLUMN chain_id DROP NOT NULL;
