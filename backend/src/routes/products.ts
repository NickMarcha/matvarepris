import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

// Net carbs and macro-%-of-energy aren't stored — they're cheap to derive
// from carbs_total/fiber/protein/fat/energy_kcal at query time, same
// approach as discountPercent below.
// Clamped at 0: fiber is normally a subset of total carbs on a nutrition
// label, but a handful of source pages report fiber larger than the total
// carbs figure (e.g. chia seeds: 1.8g carbs, 41g fiber — internally
// inconsistent data, not something we can correct), which would otherwise
// produce a nonsensical negative "net carbs".
const NET_CARBS_EXPR = "GREATEST(0, carbs_total - COALESCE(fiber, 0))";
// Bulk "weigh at checkout" bin items (candy scoops, salad bars) sometimes
// carry placeholder nutrition (kcal=1, protein=1, ...) rather than real
// per-100g values — dividing by a near-zero kcal blows the percentage up to
// implausible numbers (e.g. 400%). Below this floor we treat energy as
// unknown rather than computing a nonsense ratio.
const MIN_PLAUSIBLE_KCAL = 5;
function percentOfEnergyExpr(gramsColumn: string, kcalPerGram: number): string {
  return `(CASE WHEN energy_kcal >= ${MIN_PLAUSIBLE_KCAL} THEN ${gramsColumn} * ${kcalPerGram} / energy_kcal * 100 END)`;
}

const SORT_COLUMNS: Record<string, string> = {
  name: "title",
  price: "current_price",
  unitPrice: "current_compare_price_per_unit",
  category: "category_name",
  // discount_amount/original_price are only set for genuine sticker-price
  // cuts (see ingest/ngdataClient.ts) — "3 for 2" style promos stay NULL
  // here so they don't pollute a discount sort.
  discountPercent:
    "(CASE WHEN discount_amount IS NOT NULL AND original_price > 0 THEN discount_amount / original_price END)",
  discountAmount: "discount_amount",
  calories: "energy_kcal",
  fat: "fat_total",
  saturatedFat: "saturated_fat",
  carbs: "carbs_total",
  netCarbs: NET_CARBS_EXPR,
  sugar: "sugars",
  fiber: "fiber",
  protein: "protein",
  salt: "salt",
  proteinPercent: percentOfEnergyExpr("protein", 4),
  carbsPercent: percentOfEnergyExpr("carbs_total", 4),
  fatPercent: percentOfEnergyExpr("fat_total", 9),
};

// Simple per-100g range filters: query params `min<Key>`/`max<Key>` map
// straight onto a column, e.g. minCarbs/maxCarbs -> carbs_total.
const RANGE_FILTER_COLUMNS: Record<string, string> = {
  Calories: "energy_kcal",
  Fat: "fat_total",
  SaturatedFat: "saturated_fat",
  Carbs: "carbs_total",
  Sugar: "sugars",
  Fiber: "fiber",
  Protein: "protein",
  Salt: "salt",
};

const IMAGE_BASE = "https://bilder.ngdata.no";

function imageUrl(imagePath: string | null): string | null {
  return imagePath ? `${IMAGE_BASE}/${imagePath}/medium.jpg` : null;
}

function num(value: unknown): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

function toApiProduct(row: any) {
  const protein = num(row.protein);
  const carbs = num(row.carbs_total);
  const fat = num(row.fat_total);
  const fiber = num(row.fiber);
  const energyKcal = num(row.energy_kcal);

  return {
    id: row.id,
    chain: row.chain_key,
    ean: row.ean,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category_name,
    brand: row.brand,
    vendor: row.vendor,
    unit: row.unit,
    unitType: row.unit_type,
    compareUnit: row.compare_unit,
    weight: row.weight !== null ? Number(row.weight) : null,
    price: row.current_price !== null ? Number(row.current_price) : null,
    pricePerUnit: row.current_price_per_unit !== null ? Number(row.current_price_per_unit) : null,
    comparePricePerUnit:
      row.current_compare_price_per_unit !== null ? Number(row.current_compare_price_per_unit) : null,
    originalPrice: row.original_price !== null ? Number(row.original_price) : null,
    discountAmount: row.discount_amount !== null ? Number(row.discount_amount) : null,
    discountPercent:
      row.discount_amount !== null && row.original_price !== null && Number(row.original_price) > 0
        ? Math.round((Number(row.discount_amount) / Number(row.original_price)) * 1000) / 10
        : null,
    isOffer: row.is_offer,
    isOutOfStock: row.is_out_of_stock,
    isForSale: row.is_for_sale,
    promotionName: row.promotion_name,
    isLocal: row.is_local,
    containsAlcohol: row.contains_alcohol,
    imageUrl: imageUrl(row.image_path),
    productUrl: row.slugified_url ? `https://${row.chain_key}.no/varer${row.slugified_url}` : null,
    lastSeenAt: row.last_seen_at,
    nutrition: {
      energyKj: num(row.energy_kj),
      energyKcal,
      fat,
      saturatedFat: num(row.saturated_fat),
      monounsaturatedFat: num(row.monounsaturated_fat),
      polyunsaturatedFat: num(row.polyunsaturated_fat),
      carbs,
      netCarbs: carbs !== null ? Math.max(0, Math.round((carbs - (fiber ?? 0)) * 10) / 10) : null,
      sugars: num(row.sugars),
      sugarAlcohols: num(row.sugar_alcohols),
      starch: num(row.starch),
      fiber,
      protein,
      salt: num(row.salt),
      proteinPercent:
        protein !== null && energyKcal !== null && energyKcal >= MIN_PLAUSIBLE_KCAL
          ? Math.round(((protein * 4) / energyKcal) * 1000) / 10
          : null,
      carbsPercent:
        carbs !== null && energyKcal !== null && energyKcal >= MIN_PLAUSIBLE_KCAL
          ? Math.round(((carbs * 4) / energyKcal) * 1000) / 10
          : null,
      fatPercent:
        fat !== null && energyKcal !== null && energyKcal >= MIN_PLAUSIBLE_KCAL
          ? Math.round(((fat * 9) / energyKcal) * 1000) / 10
          : null,
      fetchedAt: row.nutrition_fetched_at,
    },
    containsAllergens: row.contains_allergens ?? [],
    dietFlags: row.contains_diet_flags ?? [],
    dietParseStatus: row.diet_parse_status,
    dietUnmatchedTokens: row.diet_unmatched_tokens ?? [],
  };
}

router.get("/products", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const {
    chain,
    search,
    includeCategories,
    excludeCategories,
    minPrice,
    maxPrice,
    minUnitPrice,
    maxUnitPrice,
    onOffer,
    inStock,
    minNetCarbs,
    maxNetCarbs,
    minProteinPercent,
    maxProteinPercent,
    minCarbsPercent,
    maxCarbsPercent,
    minFatPercent,
    maxFatPercent,
    avoidAllergens,
    requireAllergens,
    avoidDietTags,
    requireDietTags,
    sort = "name",
    order = "asc",
    page = "1",
    pageSize = "50",
  } = q;

  const conditions: string[] = [];
  const params: unknown[] = [];

  function addParam(value: unknown): number {
    params.push(value);
    return params.length;
  }

  if (chain) {
    const chains = chain.split(",").map((c) => c.trim()).filter(Boolean);
    if (chains.length > 0) {
      conditions.push(`chain_key = ANY($${addParam(chains)})`);
    }
  }

  if (search) {
    const idx = addParam(`%${search}%`);
    conditions.push(`(title ILIKE $${idx} OR subtitle ILIKE $${idx} OR brand ILIKE $${idx})`);
  }

  // Category names aren't unified across chains (e.g. Meny "Fisk & skalldyr"
  // vs Spar "Fisk og skalldyr" vs Joker "Fisk/Skalldyr" for the same concept)
  // — we deliberately don't guess a mapping, so these operate on the raw
  // per-chain category_name values the frontend lets you multi-select.
  // Uncategorized products stay visible under exclude (same "unknown isn't
  // excluded" reasoning as the allergen filters below); include naturally
  // drops them, which is correct — you asked for specific categories only.
  if (excludeCategories) {
    const list = excludeCategories.split(",").map((c) => c.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`(category_name IS NULL OR NOT (category_name = ANY($${addParam(list)})))`);
    }
  }
  if (includeCategories) {
    const list = includeCategories.split(",").map((c) => c.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`category_name = ANY($${addParam(list)})`);
    }
  }

  if (minPrice) conditions.push(`current_price >= $${addParam(Number(minPrice))}`);
  if (maxPrice) conditions.push(`current_price <= $${addParam(Number(maxPrice))}`);
  if (minUnitPrice) conditions.push(`current_compare_price_per_unit >= $${addParam(Number(minUnitPrice))}`);
  if (maxUnitPrice) conditions.push(`current_compare_price_per_unit <= $${addParam(Number(maxUnitPrice))}`);

  if (onOffer === "true") conditions.push(`is_offer = true`);
  if (inStock === "true") conditions.push(`is_out_of_stock = false AND is_for_sale = true`);

  // Raw per-100g macro range filters: minCarbs, maxCarbs, minProtein, ...
  for (const [key, column] of Object.entries(RANGE_FILTER_COLUMNS)) {
    const minVal = q[`min${key}`];
    const maxVal = q[`max${key}`];
    if (minVal) conditions.push(`${column} >= $${addParam(Number(minVal))}`);
    if (maxVal) conditions.push(`${column} <= $${addParam(Number(maxVal))}`);
  }

  if (minNetCarbs) conditions.push(`${NET_CARBS_EXPR} >= $${addParam(Number(minNetCarbs))}`);
  if (maxNetCarbs) conditions.push(`${NET_CARBS_EXPR} <= $${addParam(Number(maxNetCarbs))}`);

  if (minProteinPercent) conditions.push(`${percentOfEnergyExpr("protein", 4)} >= $${addParam(Number(minProteinPercent))}`);
  if (maxProteinPercent) conditions.push(`${percentOfEnergyExpr("protein", 4)} <= $${addParam(Number(maxProteinPercent))}`);
  if (minCarbsPercent) conditions.push(`${percentOfEnergyExpr("carbs_total", 4)} >= $${addParam(Number(minCarbsPercent))}`);
  if (maxCarbsPercent) conditions.push(`${percentOfEnergyExpr("carbs_total", 4)} <= $${addParam(Number(maxCarbsPercent))}`);
  if (minFatPercent) conditions.push(`${percentOfEnergyExpr("fat_total", 9)} >= $${addParam(Number(minFatPercent))}`);
  if (maxFatPercent) conditions.push(`${percentOfEnergyExpr("fat_total", 9)} <= $${addParam(Number(maxFatPercent))}`);

  // Products not yet crawled for nutrition (contains_allergens IS NULL) are
  // kept visible under "avoid" — we simply don't know yet, so we don't hide
  // them. "Require" is the opposite: unknown means we can't confirm the
  // match, so it's excluded. This asymmetry is intentional, not a bug — see
  // README for the caveat this implies while the background crawl backlog
  // is still being worked through.
  if (avoidAllergens) {
    const list = avoidAllergens.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`(contains_allergens IS NULL OR NOT (contains_allergens && $${addParam(list)}))`);
    }
  }
  if (requireAllergens) {
    const list = requireAllergens.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`contains_allergens @> $${addParam(list)}`);
    }
  }

  // Ingredient-parsed diet signals (meat/gelatin/honey) — a separate array
  // from contains_allergens on purpose (heuristic parser output, not
  // legally-standardized data), same avoid/require semantics as above.
  if (avoidDietTags) {
    const list = avoidDietTags.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`(contains_diet_flags IS NULL OR NOT (contains_diet_flags && $${addParam(list)}))`);
    }
  }
  if (requireDietTags) {
    const list = requireDietTags.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      conditions.push(`contains_diet_flags @> $${addParam(list)}`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortColumn = SORT_COLUMNS[sort] ?? "title";
  const sortOrder = order === "desc" ? "DESC" : "ASC";
  // Push NULLs (e.g. products missing a unit price) to the end regardless of direction.
  const orderClause = `ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${sortOrder}`;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * pageSizeNum;

  const countResult = await pool.query(`SELECT COUNT(*) FROM products ${whereClause}`, params);
  const total = Number(countResult.rows[0].count);

  const itemParams = [...params, pageSizeNum, offset];
  const limitIdx = itemParams.length - 1;
  const offsetIdx = itemParams.length;

  const itemsResult = await pool.query(
    `SELECT * FROM products ${whereClause} ${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    itemParams,
  );

  res.json({
    total,
    page: pageNum,
    pageSize: pageSizeNum,
    items: itemsResult.rows.map(toApiProduct),
  });
});

router.get("/products/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  const productResult = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
  if (productResult.rows.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const historyResult = await pool.query(
    `SELECT changed_at, price, compare_price_per_unit, original_price, discount_amount, is_offer, is_out_of_stock, is_for_sale, promotion_name
     FROM price_history WHERE product_id = $1 ORDER BY changed_at ASC`,
    [id],
  );

  res.json({
    product: toApiProduct(productResult.rows[0]),
    history: historyResult.rows.map((r) => ({
      changedAt: r.changed_at,
      price: r.price !== null ? Number(r.price) : null,
      comparePricePerUnit: r.compare_price_per_unit !== null ? Number(r.compare_price_per_unit) : null,
      originalPrice: r.original_price !== null ? Number(r.original_price) : null,
      discountAmount: r.discount_amount !== null ? Number(r.discount_amount) : null,
      isOffer: r.is_offer,
      isOutOfStock: r.is_out_of_stock,
      isForSale: r.is_for_sale,
      promotionName: r.promotion_name,
    })),
  });
});

export default router;
