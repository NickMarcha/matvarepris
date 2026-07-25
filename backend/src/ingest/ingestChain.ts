import { pool } from "../db/pool.js";
import type { ChainConfig, NormalizedProduct } from "../types.js";
import { fetchCategories, fetchProductPage, sleep } from "./ngdataClient.js";
import { mapWithConcurrency } from "./concurrency.js";

const PAGE_SIZE = 1000;
const DELAY_BETWEEN_PAGES_MS = 250;
const UPSERT_CONCURRENCY = 20;

export interface IngestSummary {
  chain: string;
  totalSeen: number;
  inserted: number;
  changed: number;
  unchanged: number;
  errors: number;
  durationMs: number;
}

const UPSERT_SQL = `
INSERT INTO products (
  chain_key, ean, title, subtitle, category_name, brand, vendor, unit, unit_type,
  compare_unit, weight, image_path, slugified_url, is_local, contains_alcohol,
  current_price, current_price_per_unit, current_compare_price_per_unit,
  original_price, discount_amount,
  is_offer, is_out_of_stock, is_for_sale, promotion_name, promotion_id
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
)
ON CONFLICT (chain_key, ean) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  category_name = EXCLUDED.category_name,
  brand = EXCLUDED.brand,
  vendor = EXCLUDED.vendor,
  unit = EXCLUDED.unit,
  unit_type = EXCLUDED.unit_type,
  compare_unit = EXCLUDED.compare_unit,
  weight = EXCLUDED.weight,
  image_path = EXCLUDED.image_path,
  slugified_url = EXCLUDED.slugified_url,
  is_local = EXCLUDED.is_local,
  contains_alcohol = EXCLUDED.contains_alcohol,
  current_price = EXCLUDED.current_price,
  current_price_per_unit = EXCLUDED.current_price_per_unit,
  current_compare_price_per_unit = EXCLUDED.current_compare_price_per_unit,
  original_price = EXCLUDED.original_price,
  discount_amount = EXCLUDED.discount_amount,
  is_offer = EXCLUDED.is_offer,
  is_out_of_stock = EXCLUDED.is_out_of_stock,
  is_for_sale = EXCLUDED.is_for_sale,
  promotion_name = EXCLUDED.promotion_name,
  promotion_id = EXCLUDED.promotion_id,
  last_seen_at = now(),
  last_checked_at = now()
RETURNING id
`;

function numsDiffer(a: string | null, b: number | null): boolean {
  const an = a === null ? null : Number(a);
  if (an === null && b === null) return false;
  if (an === null || b === null) return true;
  return Math.abs(an - b) > 0.001;
}

async function upsertProduct(chainKey: string, p: NormalizedProduct): Promise<"inserted" | "changed" | "unchanged"> {
  const existing = await pool.query<{
    current_price: string | null;
    current_compare_price_per_unit: string | null;
    discount_amount: string | null;
    is_offer: boolean;
    is_out_of_stock: boolean;
    is_for_sale: boolean;
  }>(
    `SELECT current_price, current_compare_price_per_unit, discount_amount, is_offer, is_out_of_stock, is_for_sale
     FROM products WHERE chain_key = $1 AND ean = $2`,
    [chainKey, p.ean],
  );
  const prev = existing.rows[0];

  const result = await pool.query<{ id: number }>(UPSERT_SQL, [
    chainKey,
    p.ean,
    p.title,
    p.subtitle,
    p.categoryName,
    p.brand,
    p.vendor,
    p.unit,
    p.unitType,
    p.compareUnit,
    p.weight,
    p.imagePath,
    p.slugifiedUrl,
    p.isLocal,
    p.containsAlcohol,
    p.price,
    p.pricePerUnit,
    p.comparePricePerUnit,
    p.originalPrice,
    p.discountAmount,
    p.isOffer,
    p.isOutOfStock,
    p.isForSale,
    p.promotionName,
    p.promotionId,
  ]);
  const productId = result.rows[0].id;

  if (!prev) return "inserted";

  const changed =
    numsDiffer(prev.current_price, p.price) ||
    numsDiffer(prev.current_compare_price_per_unit, p.comparePricePerUnit) ||
    numsDiffer(prev.discount_amount, p.discountAmount) ||
    prev.is_offer !== p.isOffer ||
    prev.is_out_of_stock !== p.isOutOfStock ||
    prev.is_for_sale !== p.isForSale;

  if (changed) {
    await pool.query(
      `INSERT INTO price_history (product_id, price, compare_price_per_unit, original_price, discount_amount, is_offer, is_out_of_stock, is_for_sale, promotion_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        productId,
        p.price,
        p.comparePricePerUnit,
        p.originalPrice,
        p.discountAmount,
        p.isOffer,
        p.isOutOfStock,
        p.isForSale,
        p.promotionName,
      ],
    );
    return "changed";
  }

  return "unchanged";
}

export async function ingestChain(chain: ChainConfig): Promise<IngestSummary> {
  const start = Date.now();
  const summary: IngestSummary = {
    chain: chain.key,
    totalSeen: 0,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    durationMs: 0,
  };

  const categories = await fetchCategories(chain.chainId);
  if (categories.length === 0) {
    console.warn(`[ingest:${chain.key}] no categories returned, nothing to ingest`);
    summary.durationMs = Date.now() - start;
    return summary;
  }

  for (const category of categories) {
    let page = 1;
    let total = Infinity;

    while ((page - 1) * PAGE_SIZE < total) {
      let result;
      try {
        result = await fetchProductPage(chain.chainId, page, PAGE_SIZE, category.name);
      } catch (err) {
        console.error(`[ingest:${chain.key}] failed to fetch category="${category.name}" page=${page}:`, err);
        summary.errors++;
        break;
      }

      total = result.total;
      if (result.products.length === 0) break;

      const outcomes = await mapWithConcurrency(result.products, UPSERT_CONCURRENCY, async (p) => {
        try {
          return await upsertProduct(chain.key, p);
        } catch (err) {
          console.error(`[ingest:${chain.key}] failed to upsert ean=${p.ean}:`, err);
          return "error" as const;
        }
      });

      for (const outcome of outcomes) {
        summary.totalSeen++;
        if (outcome === "inserted") summary.inserted++;
        else if (outcome === "changed") summary.changed++;
        else if (outcome === "unchanged") summary.unchanged++;
        else summary.errors++;
      }

      page++;
      if ((page - 1) * PAGE_SIZE < total) {
        await sleep(DELAY_BETWEEN_PAGES_MS);
      }
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
