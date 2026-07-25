import { pool } from "../db/pool.js";
import { fetchProductDetail, type ProductDetail } from "./productDetail.js";
import { classifyDiet } from "./dietClassifier.js";

// Maps the Norwegian nutritionalContent[].name keys (confirmed against real
// product pages — see README) to the flat columns on `products`. Kept in one
// place so the on-demand detail route and the background crawler write
// identical data from the same page fetch.
const NUTRIENT_COLUMN_MAP: Record<string, string> = {
  energi_kj: "energy_kj",
  energi_kcal: "energy_kcal",
  fett_totalt: "fat_total",
  mettet_fett: "saturated_fat",
  enumettet_fett: "monounsaturated_fat",
  flerumettet_fett: "polyunsaturated_fat",
  karbohydrater: "carbs_total",
  sukkerarter: "sugars",
  polyoler: "sugar_alcohols", // raw API key for "Sukkeralkoholer"
  stivelse: "starch",
  kostfiber: "fiber",
  protein: "protein",
  salt: "salt",
};

export interface ProductRef {
  id: number;
  chainKey: string;
  slugifiedUrl: string | null;
}

export interface SyncResult {
  ok: boolean;
  detail: ProductDetail | null;
}

async function markAttempted(productId: number): Promise<void> {
  // Still stamp nutrition_fetched_at even on failure, so a product missing
  // page data (rare) doesn't jam the crawler's backlog by being retried
  // forever instead of moving on to the next unfetched product.
  await pool.query(`UPDATE products SET nutrition_fetched_at = now() WHERE id = $1`, [productId]);
}

export async function syncProductNutrition(product: ProductRef): Promise<SyncResult> {
  if (!product.slugifiedUrl) {
    await markAttempted(product.id);
    return { ok: false, detail: null };
  }

  const detail = await fetchProductDetail(`https://${product.chainKey}.no/varer${product.slugifiedUrl}`);
  if (!detail) {
    await markAttempted(product.id);
    return { ok: false, detail: null };
  }

  const nutrientValues = Object.keys(NUTRIENT_COLUMN_MAP).map((rawKey) => {
    const entry = detail.nutritionalContent?.find((n) => n.name === rawKey);
    return entry ? entry.amount : null;
  });

  const containsAllergens = detail.allergens?.filter((a) => a.code === "JA").map((a) => a.name) ?? null;
  const diet = classifyDiet(detail.ingredients);

  await pool.query(
    `UPDATE products SET
      energy_kj = $2, energy_kcal = $3, fat_total = $4, saturated_fat = $5,
      monounsaturated_fat = $6, polyunsaturated_fat = $7, carbs_total = $8,
      sugars = $9, sugar_alcohols = $10, starch = $11, fiber = $12, protein = $13, salt = $14,
      contains_allergens = $15, contains_diet_flags = $16, diet_parse_status = $17,
      diet_unmatched_tokens = $18, nutrition_fetched_at = now()
     WHERE id = $1`,
    [
      product.id,
      ...nutrientValues,
      containsAllergens,
      diet.flags,
      diet.parseStatus,
      diet.unmatchedTokens,
    ],
  );

  await pool.query(
    `INSERT INTO product_details (
      product_id, ingredients, allergy_declaration, allergens, nutritional_content,
      country_of_origin, production_country, relevant_info, package_size, fetched_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
    ON CONFLICT (product_id) DO UPDATE SET
      ingredients = EXCLUDED.ingredients,
      allergy_declaration = EXCLUDED.allergy_declaration,
      allergens = EXCLUDED.allergens,
      nutritional_content = EXCLUDED.nutritional_content,
      country_of_origin = EXCLUDED.country_of_origin,
      production_country = EXCLUDED.production_country,
      relevant_info = EXCLUDED.relevant_info,
      package_size = EXCLUDED.package_size,
      fetched_at = now()`,
    [
      product.id,
      detail.ingredients,
      detail.allergyDeclaration,
      detail.allergens ? JSON.stringify(detail.allergens) : null,
      detail.nutritionalContent ? JSON.stringify(detail.nutritionalContent) : null,
      detail.countryOfOrigin,
      detail.productionCountry,
      detail.relevantInfo,
      detail.packageSize,
    ],
  );

  return { ok: true, detail };
}
