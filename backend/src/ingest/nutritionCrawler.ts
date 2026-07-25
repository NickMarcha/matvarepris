import { pool } from "../db/pool.js";
import { sleep } from "./ngdataClient.js";
import { syncProductNutrition } from "./nutritionSync.js";

// Deliberately slow and sequential (never parallel) — this hits the live
// storefront's actual product pages (heavy HTML, not the lightweight bulk
// search API), one page fetch at a time, with jitter so it doesn't look like
// a metronome. Default ~1 request every 2-3s: a ~21k-product backlog takes
// roughly half a day, which is fine — it only needs to run once; after that
// it's just the trickle of genuinely new products from each catalog ingest.
const BASE_DELAY_MS = Number(process.env.NUTRITION_CRAWL_DELAY_MS ?? 2000);
const JITTER_MS = 1000;
const IDLE_SLEEP_MS = 5 * 60 * 1000; // backlog empty — recheck every 5 min

export interface NutritionCrawlStatus {
  totalProducts: number;
  remaining: number;
  crawled: number;
}

export async function getNutritionCrawlStatus(): Promise<NutritionCrawlStatus> {
  const result = await pool.query<{ total: string; remaining: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE nutrition_fetched_at IS NULL) AS remaining FROM products`,
  );
  const totalProducts = Number(result.rows[0].total);
  const remaining = Number(result.rows[0].remaining);
  return { totalProducts, remaining, crawled: totalProducts - remaining };
}

export function startNutritionCrawler(): void {
  console.log(`[nutrition-crawler] starting (delay ~${BASE_DELAY_MS}-${BASE_DELAY_MS + JITTER_MS}ms per product)`);
  void runLoop();
}

async function runLoop(): Promise<void> {
  while (true) {
    let handled = false;
    try {
      const next = await pool.query<{ id: number; chain_key: string; slugified_url: string | null }>(
        `SELECT id, chain_key, slugified_url FROM products WHERE nutrition_fetched_at IS NULL ORDER BY id LIMIT 1`,
      );

      if (next.rows.length === 0) {
        await sleep(IDLE_SLEEP_MS);
        continue;
      }

      const row = next.rows[0];
      handled = true;
      try {
        await syncProductNutrition({ id: row.id, chainKey: row.chain_key, slugifiedUrl: row.slugified_url });
      } catch (err) {
        // Transient (network/DB) failure — leave nutrition_fetched_at NULL so
        // this product is simply retried on a later pass rather than
        // permanently skipped. syncProductNutrition already handles the
        // "page fetched but no product data found" case internally.
        console.error(`[nutrition-crawler] failed for product ${row.id}:`, err);
      }
    } catch (err) {
      console.error("[nutrition-crawler] loop error:", err);
    }

    if (handled) {
      await sleep(BASE_DELAY_MS + Math.random() * JITTER_MS);
    }
  }
}
