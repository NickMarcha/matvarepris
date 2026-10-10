import { Router, type RequestHandler } from "express";
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
// `prefix` lets the same expression run against a table alias (e.g. "r" for
// the representative row in the grouped-products query below) without
// duplicating the clamp logic or its comments.
function netCarbsExpr(prefix = ""): string {
  const p = prefix ? `${prefix}.` : "";
  return `GREATEST(0, ${p}carbs_total - COALESCE(${p}fiber, 0))`;
}
const NET_CARBS_EXPR = netCarbsExpr();
// Bulk "weigh at checkout" bin items (candy scoops, salad bars) sometimes
// carry placeholder nutrition (kcal=1, protein=1, ...) rather than real
// per-100g values — dividing by a near-zero kcal blows the percentage up to
// implausible numbers (e.g. 400%). Below this floor we treat energy as
// unknown rather than computing a nonsense ratio.
const MIN_PLAUSIBLE_KCAL = 5;
function percentOfEnergyExpr(gramsColumn: string, kcalPerGram: number, prefix = ""): string {
  const p = prefix ? `${prefix}.` : "";
  return `(CASE WHEN ${p}energy_kcal >= ${MIN_PLAUSIBLE_KCAL} THEN ${p}${gramsColumn} * ${kcalPerGram} / ${p}energy_kcal * 100 END)`;
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

export function toApiProduct(row: any) {
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

// Same sort keys as SORT_COLUMNS, reinterpreted for a group: price/discount
// sorts mean "cheapest"/"best deal across the group's member rows" (via the
// grouped-query aggregates below), everything else reads off the
// representative row (r.-prefixed).
const GROUPED_SORT_COLUMNS: Record<string, string> = {
  name: "r.title",
  price: "cheapest_price",
  unitPrice: "cheapest_unit_price",
  category: "r.category_name",
  discountPercent: "best_discount_percent",
  discountAmount: "best_discount_amount",
  calories: "r.energy_kcal",
  fat: "r.fat_total",
  saturatedFat: "r.saturated_fat",
  carbs: "r.carbs_total",
  netCarbs: netCarbsExpr("r"),
  sugar: "r.sugars",
  fiber: "r.fiber",
  protein: "r.protein",
  salt: "r.salt",
  proteinPercent: percentOfEnergyExpr("protein", 4, "r"),
  carbsPercent: percentOfEnergyExpr("carbs_total", 4, "r"),
  fatPercent: percentOfEnergyExpr("fat_total", 9, "r"),
};

// Absolute-difference tolerances for flagging that crawled stores disagree
// on a shared EAN's nutrition — small enough to catch a genuinely wrong or
// stale source, loose enough to not fire on ordinary label-rounding noise
// between otherwise-identical scrapes.
const MISMATCH_TOLERANCE = { kcal: 15, protein: 2, carbs: 2, fat: 2 };

function toApiGroup(row: any) {
  const kcalMismatch = row.kcal_spread !== null && Number(row.kcal_spread) > MISMATCH_TOLERANCE.kcal;
  const proteinMismatch = row.protein_spread !== null && Number(row.protein_spread) > MISMATCH_TOLERANCE.protein;
  const carbsMismatch = row.carbs_spread !== null && Number(row.carbs_spread) > MISMATCH_TOLERANCE.carbs;
  const fatMismatch = row.fat_spread !== null && Number(row.fat_spread) > MISMATCH_TOLERANCE.fat;
  const allergenMismatch = Number(row.allergen_variants) > 1;

  const mismatchNotes: string[] = [];
  if (kcalMismatch) mismatchNotes.push(`kalorier (spredning ${row.kcal_spread} kcal)`);
  if (proteinMismatch) mismatchNotes.push(`protein (spredning ${row.protein_spread} g)`);
  if (carbsMismatch) mismatchNotes.push(`karbohydrater (spredning ${row.carbs_spread} g)`);
  if (fatMismatch) mismatchNotes.push(`fett (spredning ${row.fat_spread} g)`);
  if (allergenMismatch) mismatchNotes.push("allergener");

  return {
    ean: row.ean,
    memberCount: Number(row.member_count),
    cheapestPrice: num(row.cheapest_price),
    cheapestUnitPrice: num(row.cheapest_unit_price),
    bestDiscountAmount: num(row.best_discount_amount),
    bestDiscountPercent:
      row.best_discount_percent !== null ? Math.round(Number(row.best_discount_percent) * 1000) / 10 : null,
    anyOnOffer: row.any_on_offer,
    anyInStock: row.any_in_stock,
    hasDataMismatch: mismatchNotes.length > 0,
    mismatchNote: mismatchNotes.length > 0 ? `Varierer mellom butikker: ${mismatchNotes.join(", ")} — se detaljer` : null,
    representative: toApiProduct(row.representative_row),
    members: (row.members as any[]).map(toApiProduct), // already cheapest-first from json_agg's ORDER BY
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

// Cross-chain view: one entry per EAN instead of one per (chain, ean) row —
// see CLAUDE.md / plan for the full rationale. Accepts the same query params
// as GET /products; category/search/price/offer/stock filters use "any
// member row matches" (bool_or/bool_and, HAVING, applied per ean group)
// since those are legitimately per-store facts, while nutrition/allergen/
// diet filters apply only to the chosen "representative" row (r.*) — the
// same physical product is assumed to have one true nutrition profile, and
// hasDataMismatch (below) flags when crawled stores actually disagree on it.
// Exported so GET /api/v1/products can run the same search and shape the
// rows its own way; the route below keeps the UI's response format.
export async function queryGroupedProducts(q: Record<string, string | undefined>) {
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

  const baseConditions: string[] = []; // WHERE on `base` (structural chain visibility only)
  const havingConditions: string[] = []; // HAVING on `grouped` — "any member matches"
  const repConditions: string[] = []; // WHERE on the joined query, r.-prefixed — representative-row-only
  const params: unknown[] = [];

  function addParam(value: unknown): number {
    params.push(value);
    return params.length;
  }

  if (chain) {
    const chains = chain.split(",").map((c) => c.trim()).filter(Boolean);
    if (chains.length > 0) {
      baseConditions.push(`chain_key = ANY($${addParam(chains)})`);
    }
  }

  if (search) {
    const idx = addParam(`%${search}%`);
    havingConditions.push(`bool_or(title ILIKE $${idx} OR subtitle ILIKE $${idx} OR brand ILIKE $${idx})`);
  }

  if (excludeCategories) {
    const list = excludeCategories.split(",").map((c) => c.trim()).filter(Boolean);
    if (list.length > 0) {
      havingConditions.push(`bool_and(category_name IS NULL OR NOT (category_name = ANY($${addParam(list)})))`);
    }
  }
  if (includeCategories) {
    const list = includeCategories.split(",").map((c) => c.trim()).filter(Boolean);
    if (list.length > 0) {
      havingConditions.push(`bool_or(category_name = ANY($${addParam(list)}))`);
    }
  }

  // min/max combined into one BETWEEN when both are given — two independent
  // bool_or(...) checks would let two *different* members each satisfy one
  // bound without either satisfying both, which isn't "a member in range".
  if (minPrice && maxPrice) {
    havingConditions.push(
      `bool_or(current_price BETWEEN $${addParam(Number(minPrice))} AND $${addParam(Number(maxPrice))})`,
    );
  } else if (minPrice) {
    havingConditions.push(`bool_or(current_price >= $${addParam(Number(minPrice))})`);
  } else if (maxPrice) {
    havingConditions.push(`bool_or(current_price <= $${addParam(Number(maxPrice))})`);
  }

  if (minUnitPrice && maxUnitPrice) {
    havingConditions.push(
      `bool_or(current_compare_price_per_unit BETWEEN $${addParam(Number(minUnitPrice))} AND $${addParam(Number(maxUnitPrice))})`,
    );
  } else if (minUnitPrice) {
    havingConditions.push(`bool_or(current_compare_price_per_unit >= $${addParam(Number(minUnitPrice))})`);
  } else if (maxUnitPrice) {
    havingConditions.push(`bool_or(current_compare_price_per_unit <= $${addParam(Number(maxUnitPrice))})`);
  }

  if (onOffer === "true") havingConditions.push(`bool_or(is_offer)`);
  if (inStock === "true") havingConditions.push(`bool_or(NOT is_out_of_stock AND is_for_sale)`);

  // Raw per-100g macro range filters — representative row only.
  for (const [key, column] of Object.entries(RANGE_FILTER_COLUMNS)) {
    const minVal = q[`min${key}`];
    const maxVal = q[`max${key}`];
    if (minVal) repConditions.push(`r.${column} >= $${addParam(Number(minVal))}`);
    if (maxVal) repConditions.push(`r.${column} <= $${addParam(Number(maxVal))}`);
  }

  if (minNetCarbs) repConditions.push(`${netCarbsExpr("r")} >= $${addParam(Number(minNetCarbs))}`);
  if (maxNetCarbs) repConditions.push(`${netCarbsExpr("r")} <= $${addParam(Number(maxNetCarbs))}`);

  if (minProteinPercent)
    repConditions.push(`${percentOfEnergyExpr("protein", 4, "r")} >= $${addParam(Number(minProteinPercent))}`);
  if (maxProteinPercent)
    repConditions.push(`${percentOfEnergyExpr("protein", 4, "r")} <= $${addParam(Number(maxProteinPercent))}`);
  if (minCarbsPercent)
    repConditions.push(`${percentOfEnergyExpr("carbs_total", 4, "r")} >= $${addParam(Number(minCarbsPercent))}`);
  if (maxCarbsPercent)
    repConditions.push(`${percentOfEnergyExpr("carbs_total", 4, "r")} <= $${addParam(Number(maxCarbsPercent))}`);
  if (minFatPercent)
    repConditions.push(`${percentOfEnergyExpr("fat_total", 9, "r")} >= $${addParam(Number(minFatPercent))}`);
  if (maxFatPercent)
    repConditions.push(`${percentOfEnergyExpr("fat_total", 9, "r")} <= $${addParam(Number(maxFatPercent))}`);

  if (avoidAllergens) {
    const list = avoidAllergens.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      repConditions.push(`(r.contains_allergens IS NULL OR NOT (r.contains_allergens && $${addParam(list)}))`);
    }
  }
  if (requireAllergens) {
    const list = requireAllergens.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      repConditions.push(`r.contains_allergens @> $${addParam(list)}`);
    }
  }
  if (avoidDietTags) {
    const list = avoidDietTags.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      repConditions.push(`(r.contains_diet_flags IS NULL OR NOT (r.contains_diet_flags && $${addParam(list)}))`);
    }
  }
  if (requireDietTags) {
    const list = requireDietTags.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.length > 0) {
      repConditions.push(`r.contains_diet_flags @> $${addParam(list)}`);
    }
  }

  const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(" AND ")}` : "";
  const havingClause = havingConditions.length > 0 ? `HAVING ${havingConditions.join(" AND ")}` : "";
  const repWhere = repConditions.length > 0 ? `WHERE ${repConditions.join(" AND ")}` : "";

  const sortColumn = GROUPED_SORT_COLUMNS[sort] ?? "r.title";
  const sortOrder = order === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${sortOrder}`;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * pageSizeNum;

  const cte = `
    WITH base AS (
      SELECT * FROM products ${baseWhere}
    ),
    representative AS (
      SELECT DISTINCT ON (ean) *
      FROM base
      ORDER BY ean, nutrition_fetched_at DESC NULLS LAST, id ASC
    ),
    grouped AS (
      SELECT
        ean,
        COUNT(*) AS member_count,
        MIN(current_price) AS cheapest_price,
        MIN(current_compare_price_per_unit) AS cheapest_unit_price,
        MAX(discount_amount) AS best_discount_amount,
        MAX(CASE WHEN discount_amount IS NOT NULL AND original_price > 0
                 THEN discount_amount / original_price END) AS best_discount_percent,
        bool_or(is_offer) AS any_on_offer,
        bool_or(NOT is_out_of_stock AND is_for_sale) AS any_in_stock,
        json_agg(to_jsonb(base) ORDER BY current_price ASC NULLS LAST) AS members
      FROM base
      GROUP BY ean
      ${havingClause}
    ),
    mismatch AS (
      SELECT
        ean,
        MAX(energy_kcal) FILTER (WHERE nutrition_fetched_at IS NOT NULL)
          - MIN(energy_kcal) FILTER (WHERE nutrition_fetched_at IS NOT NULL) AS kcal_spread,
        MAX(protein) FILTER (WHERE nutrition_fetched_at IS NOT NULL)
          - MIN(protein) FILTER (WHERE nutrition_fetched_at IS NOT NULL) AS protein_spread,
        MAX(carbs_total) FILTER (WHERE nutrition_fetched_at IS NOT NULL)
          - MIN(carbs_total) FILTER (WHERE nutrition_fetched_at IS NOT NULL) AS carbs_spread,
        MAX(fat_total) FILTER (WHERE nutrition_fetched_at IS NOT NULL)
          - MIN(fat_total) FILTER (WHERE nutrition_fetched_at IS NOT NULL) AS fat_spread,
        COUNT(DISTINCT (SELECT array_agg(x ORDER BY x) FROM unnest(contains_allergens) x))
          FILTER (WHERE nutrition_fetched_at IS NOT NULL) AS allergen_variants
      FROM base
      GROUP BY ean
    )
  `;

  const joinAndFilter = `
    FROM grouped g
    JOIN representative r USING (ean)
    JOIN mismatch m USING (ean)
    ${repWhere}
  `;

  const countResult = await pool.query(`${cte} SELECT COUNT(*) FROM (SELECT g.ean ${joinAndFilter}) sub`, params);
  const total = Number(countResult.rows[0].count);

  const itemParams = [...params, pageSizeNum, offset];
  const limitIdx = itemParams.length - 1;
  const offsetIdx = itemParams.length;

  const itemsResult = await pool.query(
    `${cte}
     SELECT g.ean, g.member_count, g.cheapest_price, g.cheapest_unit_price,
            g.best_discount_amount, g.best_discount_percent, g.any_on_offer, g.any_in_stock, g.members,
            to_jsonb(r) AS representative_row,
            m.kcal_spread, m.protein_spread, m.carbs_spread, m.fat_spread, m.allergen_variants
     ${joinAndFilter}
     ${orderClause}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    itemParams,
  );

  return { total, page: pageNum, pageSize: pageSizeNum, rows: itemsResult.rows };
}

router.get("/products/grouped", async (req, res) => {
  const result = await queryGroupedProducts(req.query as Record<string, string | undefined>);
  res.json({
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: result.rows.map(toApiGroup),
  });
});

// Combined multi-store price history for a single EAN — finds every chain's
// row for that barcode (optionally scoped to `chain`, e.g. currently-visible
// stores) and returns one history series per chain in a single query
// (product_id = ANY(...)), not N+1.
// Also served as GET /api/v1/products/:ean/history.
export const eanHistoryHandler: RequestHandler<{ ean: string }> = async (req, res) => {
  const ean = req.params.ean;
  const { chain } = req.query as Record<string, string | undefined>;

  const conditions: string[] = ["ean = $1"];
  const params: unknown[] = [ean];
  if (chain) {
    const chains = chain.split(",").map((c) => c.trim()).filter(Boolean);
    if (chains.length > 0) {
      params.push(chains);
      conditions.push(`chain_key = ANY($${params.length})`);
    }
  }

  const productsResult = await pool.query(
    `SELECT id, chain_key, title, subtitle, compare_unit FROM products WHERE ${conditions.join(" AND ")} ORDER BY chain_key`,
    params,
  );

  if (productsResult.rows.length === 0) {
    res.status(404).json({ error: "No products found for this EAN" });
    return;
  }

  const ids = productsResult.rows.map((r) => r.id);

  const historyResult = await pool.query(
    `SELECT product_id, changed_at, price, compare_price_per_unit, original_price,
            discount_amount, is_offer, is_out_of_stock, is_for_sale, promotion_name
     FROM price_history WHERE product_id = ANY($1) ORDER BY product_id, changed_at ASC`,
    [ids],
  );

  const historyByProductId = new Map<number, unknown[]>();
  for (const row of historyResult.rows) {
    const list = historyByProductId.get(row.product_id) ?? [];
    list.push({
      changedAt: row.changed_at,
      price: row.price !== null ? Number(row.price) : null,
      comparePricePerUnit: row.compare_price_per_unit !== null ? Number(row.compare_price_per_unit) : null,
      originalPrice: row.original_price !== null ? Number(row.original_price) : null,
      discountAmount: row.discount_amount !== null ? Number(row.discount_amount) : null,
      isOffer: row.is_offer,
      isOutOfStock: row.is_out_of_stock,
      isForSale: row.is_for_sale,
      promotionName: row.promotion_name,
    });
    historyByProductId.set(row.product_id, list);
  }

  res.json({
    ean,
    chains: productsResult.rows.map((p) => ({
      chain: p.chain_key,
      // pg returns bigint columns as strings by default; cast explicitly so
      // this matches the numeric `id` toApiProduct produces elsewhere (via
      // to_jsonb, which serializes bigint as a plain JSON number instead).
      productId: Number(p.id),
      title: p.title,
      subtitle: p.subtitle,
      compareUnit: p.compare_unit,
      points: historyByProductId.get(p.id) ?? [],
    })),
  });
};

router.get("/products/by-ean/:ean/history", eanHistoryHandler);

// Live per-store pricing for a set of EANs — used by the shopping cart to
// show "what would my whole basket cost at each store" without the cart
// itself having to store stale prices from whenever items were added.
router.get("/products/cart-pricing", async (req, res) => {
  const { eans, chain } = req.query as Record<string, string | undefined>;
  const eanList = (eans ?? "").split(",").map((e) => e.trim()).filter(Boolean);

  if (eanList.length === 0) {
    res.json({ items: {} });
    return;
  }

  const conditions: string[] = ["ean = ANY($1)"];
  const params: unknown[] = [eanList];
  if (chain) {
    const chains = chain.split(",").map((c) => c.trim()).filter(Boolean);
    if (chains.length > 0) {
      params.push(chains);
      conditions.push(`chain_key = ANY($${params.length})`);
    }
  }

  const result = await pool.query(
    `SELECT ean, chain_key, current_price, current_compare_price_per_unit, compare_unit,
            is_out_of_stock, is_for_sale, slugified_url
     FROM products WHERE ${conditions.join(" AND ")}`,
    params,
  );

  const items: Record<string, unknown[]> = {};
  for (const row of result.rows) {
    const list = items[row.ean] ?? (items[row.ean] = []);
    list.push({
      chain: row.chain_key,
      price: row.current_price !== null ? Number(row.current_price) : null,
      compareUnitPrice: row.current_compare_price_per_unit !== null ? Number(row.current_compare_price_per_unit) : null,
      compareUnit: row.compare_unit,
      isOutOfStock: row.is_out_of_stock,
      isForSale: row.is_for_sale,
      productUrl: row.slugified_url ? `https://${row.chain_key}.no/varer${row.slugified_url}` : null,
    });
  }

  res.json({ items });
});

export default router;
