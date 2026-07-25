import { Router } from "express";
import { pool } from "../db/pool.js";
import { syncProductNutrition } from "../ingest/nutritionSync.js";

const router = Router();

const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ingredients/nutrition rarely change

async function buildApiDetail(id: number, row: any) {
  // Diet flags live on `products`, not `product_details` — read fresh each
  // time so a detail view that just triggered an on-demand classification
  // (via syncProductNutrition below) reflects it immediately, rather than
  // whatever was already loaded client-side from an earlier /history call.
  const dietResult = await pool.query(
    `SELECT contains_diet_flags, diet_parse_status FROM products WHERE id = $1`,
    [id],
  );
  const dietRow = dietResult.rows[0];

  return {
    ingredients: row.ingredients,
    allergyDeclaration: row.allergy_declaration,
    allergens: row.allergens,
    nutritionalContent: row.nutritional_content,
    countryOfOrigin: row.country_of_origin,
    productionCountry: row.production_country,
    relevantInfo: row.relevant_info,
    packageSize: row.package_size,
    fetchedAt: row.fetched_at,
    dietFlags: dietRow?.contains_diet_flags ?? [],
    dietParseStatus: dietRow?.diet_parse_status ?? null,
  };
}

router.get("/products/:id/detail", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  const productResult = await pool.query(
    `SELECT chain_key, slugified_url FROM products WHERE id = $1`,
    [id],
  );
  if (productResult.rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const { chain_key: chainKey, slugified_url: slugifiedUrl } = productResult.rows[0];

  const cached = await pool.query(`SELECT * FROM product_details WHERE product_id = $1`, [id]);
  if (cached.rows.length > 0) {
    const fetchedAt = new Date(cached.rows[0].fetched_at).getTime();
    if (Date.now() - fetchedAt < CACHE_MAX_AGE_MS) {
      res.json(await buildApiDetail(id, cached.rows[0]));
      return;
    }
  }

  if (!slugifiedUrl) {
    if (cached.rows.length > 0) {
      res.json(await buildApiDetail(id, cached.rows[0]));
      return;
    }
    res.status(404).json({ error: "No product page URL available for this product" });
    return;
  }

  try {
    const result = await syncProductNutrition({ id, chainKey, slugifiedUrl });
    if (!result.ok) {
      throw new Error("Could not find product data on page");
    }

    const refreshed = await pool.query(`SELECT * FROM product_details WHERE product_id = $1`, [id]);
    res.json(await buildApiDetail(id, refreshed.rows[0]));
  } catch (err) {
    console.error(`[productDetail] failed to fetch detail for product ${id}:`, err);
    if (cached.rows.length > 0) {
      res.json(await buildApiDetail(id, cached.rows[0]));
      return;
    }
    res.status(502).json({ error: "Failed to fetch product detail" });
  }
});

export default router;
