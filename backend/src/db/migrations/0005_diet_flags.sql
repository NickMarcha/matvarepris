-- Ingredient-text-derived dietary signals. Deliberately a SEPARATE array
-- from contains_allergens: allergens are legally standardized (high
-- confidence), these are our own heuristic ingredient parser (best-effort,
-- meant to keep improving over time — see diet_unmatched_tokens).
-- Values used: 'kjott' (meat), 'gelatin', 'honning' (honey).
ALTER TABLE products ADD COLUMN IF NOT EXISTS contains_diet_flags text[];

-- 'ok' once the parser has run against real ingredient text, 'no_ingredients'
-- if the product has been nutrition-crawled but the page had no ingredients
-- text to parse, NULL = not attempted yet.
ALTER TABLE products ADD COLUMN IF NOT EXISTS diet_parse_status text;

-- Tokens from the ingredient list that matched none of our dictionaries.
-- This is the iteration mechanism: aggregate this column across the corpus,
-- ranked by frequency, to find what the dictionary is still missing.
ALTER TABLE products ADD COLUMN IF NOT EXISTS diet_unmatched_tokens text[];

CREATE INDEX IF NOT EXISTS idx_products_diet_flags ON products USING gin (contains_diet_flags);
