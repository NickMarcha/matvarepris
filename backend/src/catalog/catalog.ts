import { pool } from "../db/pool.js";
import { sleep } from "../ingest/ngdataClient.js";
import { fetchProductByEan, KassalappUnavailable, type KassalappComparison } from "../ingest/kassalappClient.js";

// Barcodes no chain we read sells: what they are, from Kassalapp (Norwegian
// shelves, Coop's and Rema's own brands) and then Open Food Facts (ODbL,
// imports). Cached in catalog_products. Moved here from Susdi (#124), so
// Susdi only ever asks MatvarePris.

const KASSALAPP_KEY = process.env.KASSALAPP_API_KEY ?? "";
const FOUND_FRESH_MS = 30 * 24 * 3600 * 1000;
const MISSING_FRESH_MS = 7 * 24 * 3600 * 1000;
// Open Food Facts answered 429 at about fifteen product reads a minute.
const OFF_MIN_GAP_MS = 2000;
const OFF_USER_AGENT = "MatvarePris/1.0 (grocery price API; https://matvarepris.nickmarcha.com)";

export type CatalogNutrition = {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
};

export type CatalogProduct = {
  ean: string;
  source: "kassalapp" | "openfoodfacts";
  title: string;
  brand: string | null;
  quantityText: string | null;
  contentAmount: number | null;
  contentUnit: "kg" | "l" | null;
  imageUrl: string | null;
  nutrition: CatalogNutrition | null;
  vegan: boolean | null;
  vegetarian: boolean | null;
  fetchedAt: string;
};

// Nothing found, but a source that might have known didn't answer. Not the
// same as an unknown code: the caller should try again later.
export class SourcesDown extends Error {
  constructor(readonly sources: string[]) {
    super(`No answer from ${sources.join(", ")}`);
  }
}
class OffUnavailable extends Error {}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// 400 g -> 0.4 kg, 33 cl -> 0.33 l. Pieces and anything else: none.
function content(amount: number | null, unit: string | null | undefined): { amount: number; unit: "kg" | "l" } | null {
  if (!amount || amount <= 0 || !unit) return null;
  switch (unit.toLowerCase()) {
    case "g": return { amount: amount / 1000, unit: "kg" };
    case "kg": return { amount, unit: "kg" };
    case "ml": return { amount: amount / 1000, unit: "l" };
    case "cl": return { amount: amount / 100, unit: "l" };
    case "dl": return { amount: amount / 10, unit: "l" };
    case "l": return { amount, unit: "l" };
    default: return null;
  }
}

const anyValue = (n: CatalogNutrition) => Object.values(n).some((v) => v !== null);

type Found = Omit<CatalogProduct, "fetchedAt">;

function fromKassalapp(ean: string, c: KassalappComparison): Found | null {
  // Several stores list the same EAN; the first with a name and size says most.
  const item = c.products.find((p) => p.name && content(p.weight, p.weight_unit)) ?? c.products.find((p) => p.name);
  if (!item?.name) return null;
  const size = content(item.weight, item.weight_unit);
  const get = (...codes: string[]) => c.nutrition?.find((n) => codes.includes(n.code))?.amount ?? null;
  const nutrition: CatalogNutrition = {
    kcal: get("energi_kcal", "kalorier"),
    protein: get("protein"),
    fat: get("fett_totalt", "fett"),
    saturatedFat: get("mettet_fett"),
    carbs: get("karbohydrater"),
    sugars: get("sukkerarter"),
    fiber: get("kostfiber"),
    salt: get("salt"),
  };
  return {
    ean,
    source: "kassalapp",
    title: item.name.trim(),
    brand: item.brand?.trim() || item.vendor?.trim() || null,
    quantityText: item.weight && item.weight_unit ? `${item.weight} ${item.weight_unit}` : null,
    contentAmount: size?.amount ?? null,
    contentUnit: size?.unit ?? null,
    imageUrl: c.products.find((p) => p.image)?.image ?? null,
    nutrition: anyValue(nutrition) ? nutrition : null,
    vegan: null,
    vegetarian: null,
  };
}

type OffProduct = {
  product_name?: string;
  product_name_nb?: string;
  product_name_no?: string;
  product_name_en?: string;
  brands?: string;
  quantity?: string;
  product_quantity?: string | number;
  product_quantity_unit?: string;
  image_front_small_url?: string;
  image_small_url?: string;
  nutriments?: Record<string, number | string | undefined>;
  ingredients_analysis_tags?: string[];
};

const OFF_FIELDS = [
  "product_name", "product_name_nb", "product_name_no", "product_name_en", "brands", "quantity",
  "product_quantity", "product_quantity_unit", "image_front_small_url", "image_small_url",
  "nutriments", "ingredients_analysis_tags",
].join(",");

function fromOff(ean: string, p: OffProduct): Found | null {
  const title = [p.product_name_nb, p.product_name_no, p.product_name, p.product_name_en].find((x) => x?.trim())?.trim();
  if (!title) return null;
  const n = p.nutriments ?? {};
  const nutrition: CatalogNutrition = {
    kcal: num(n["energy-kcal_100g"]),
    protein: num(n.proteins_100g),
    fat: num(n.fat_100g),
    saturatedFat: num(n["saturated-fat_100g"]),
    carbs: num(n.carbohydrates_100g),
    sugars: num(n.sugars_100g),
    fiber: num(n.fiber_100g),
    salt: num(n.salt_100g),
  };
  const tags = p.ingredients_analysis_tags ?? [];
  const flag = (yes: string, no: string) => (tags.includes(yes) ? true : tags.includes(no) ? false : null);
  const c = content(num(p.product_quantity), p.product_quantity_unit ?? "g");
  return {
    ean,
    source: "openfoodfacts",
    title,
    brand: p.brands?.split(",")[0]?.trim() || null,
    quantityText: p.quantity?.trim() || null,
    contentAmount: c?.amount ?? null,
    contentUnit: c?.unit ?? null,
    imageUrl: p.image_front_small_url ?? p.image_small_url ?? null,
    nutrition: anyValue(nutrition) ? nutrition : null,
    vegan: flag("en:vegan", "en:non-vegan"),
    vegetarian: flag("en:vegetarian", "en:non-vegetarian"),
  };
}

let offNextSlot = 0;
async function fetchOff(ean: string): Promise<OffProduct | null> {
  const now = Date.now();
  const at = Math.max(now, offNextSlot);
  offNextSlot = at + OFF_MIN_GAP_MS;
  if (at > now) await sleep(at - now);
  let res: Response;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=${OFF_FIELDS}`, {
      headers: { "User-Agent": OFF_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new OffUnavailable(`Open Food Facts unreachable: ${String(err)}`);
  }
  // Unknown codes come back 404 with status 0.
  if (res.status === 404) return null;
  if (!res.ok) throw new OffUnavailable(`Open Food Facts answered ${res.status}`);
  const body = (await res.json()) as { status?: number; product?: OffProduct };
  return body.status === 1 && body.product ? body.product : null;
}

function fromRow(r: any): CatalogProduct {
  return {
    ean: r.ean,
    source: r.source,
    title: r.title,
    brand: r.brand,
    quantityText: r.quantity_text,
    contentAmount: r.content_amount === null ? null : Number(r.content_amount),
    contentUnit: r.content_unit,
    imageUrl: r.image_url,
    nutrition: r.nutrition,
    vegan: r.vegan,
    vegetarian: r.vegetarian,
    fetchedAt: new Date(r.fetched_at).toISOString(),
  };
}

// Cached entries only, never asks anyone. Missing EANs are absent.
export async function cachedCatalog(eans: string[]): Promise<Map<string, CatalogProduct>> {
  const out = new Map<string, CatalogProduct>();
  if (eans.length === 0) return out;
  const result = await pool.query(`SELECT * FROM catalog_products WHERE ean = ANY($1) AND found`, [eans]);
  for (const r of result.rows) out.set(r.ean, fromRow(r));
  return out;
}

async function save(ean: string, found: Found | null): Promise<CatalogProduct | null> {
  const result = await pool.query(
    `INSERT INTO catalog_products (ean, found, source, title, brand, quantity_text, content_amount, content_unit,
                                   image_url, nutrition, vegan, vegetarian, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (ean) DO UPDATE SET
       found = EXCLUDED.found, source = EXCLUDED.source, title = EXCLUDED.title, brand = EXCLUDED.brand,
       quantity_text = EXCLUDED.quantity_text, content_amount = EXCLUDED.content_amount,
       content_unit = EXCLUDED.content_unit, image_url = EXCLUDED.image_url, nutrition = EXCLUDED.nutrition,
       vegan = EXCLUDED.vegan, vegetarian = EXCLUDED.vegetarian, fetched_at = now()
     RETURNING *`,
    [
      ean, found !== null, found?.source ?? null, found?.title ?? null, found?.brand ?? null,
      found?.quantityText ?? null, found?.contentAmount ?? null, found?.contentUnit ?? null,
      found?.imageUrl ?? null, found?.nutrition ? JSON.stringify(found.nutrition) : null,
      found?.vegan ?? null, found?.vegetarian ?? null,
    ],
  );
  return found ? fromRow(result.rows[0]) : null;
}

// The cached answer if fresh, else Kassalapp, then Open Food Facts. null =
// neither knows it. Throws SourcesDown when nothing was found and a source
// didn't answer; nothing is cached then.
export async function lookupCatalog(ean: string): Promise<CatalogProduct | null> {
  const cached = await pool.query(`SELECT * FROM catalog_products WHERE ean = $1`, [ean]);
  const row = cached.rows[0];
  if (row && Date.now() - new Date(row.fetched_at).getTime() < (row.found ? FOUND_FRESH_MS : MISSING_FRESH_MS)) {
    return row.found ? fromRow(row) : null;
  }

  const down: string[] = [];
  let found: Found | null = null;
  if (KASSALAPP_KEY) {
    try {
      const c = await fetchProductByEan(KASSALAPP_KEY, ean);
      found = c ? fromKassalapp(ean, c) : null;
    } catch (err) {
      if (!(err instanceof KassalappUnavailable)) throw err;
      down.push("Kassalapp");
    }
  }
  if (!found) {
    try {
      const p = await fetchOff(ean);
      found = p ? fromOff(ean, p) : null;
    } catch (err) {
      if (!(err instanceof OffUnavailable)) throw err;
      down.push("Open Food Facts");
    }
  }
  if (!found && down.length) {
    // A stale positive answer beats none.
    if (row?.found) return fromRow(row);
    throw new SourcesDown(down);
  }
  return save(ean, found);
}
