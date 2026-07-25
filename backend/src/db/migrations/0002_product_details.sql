CREATE TABLE IF NOT EXISTS product_details (
  product_id bigint PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  ingredients text,
  allergy_declaration text,
  allergens jsonb,
  nutritional_content jsonb,
  country_of_origin text,
  production_country text,
  relevant_info text,
  package_size text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
