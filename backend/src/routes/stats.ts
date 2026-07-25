import { Router } from "express";
import { pool } from "../db/pool.js";
import { getIngestStatus } from "../ingest/runAll.js";
import { getNutritionCrawlStatus } from "../ingest/nutritionCrawler.js";

const router = Router();

router.get("/stats", async (_req, res) => {
  const [chainRows, aggregateRow, nutritionCrawl] = await Promise.all([
    pool.query(`
      SELECT c.key, c.display_name, COUNT(p.id) AS product_count, MAX(p.last_checked_at) AS last_checked_at
      FROM chains c
      LEFT JOIN products p ON p.chain_key = c.key
      GROUP BY c.key, c.display_name
      ORDER BY c.display_name ASC
    `),
    pool.query(`
      SELECT
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE is_offer) AS on_offer_count,
        ROUND(AVG(discount_amount / original_price * 100) FILTER (WHERE discount_amount IS NOT NULL AND original_price > 0), 1) AS avg_discount_percent,
        COUNT(DISTINCT category_name) AS category_count,
        (SELECT COUNT(*) FROM price_history) AS price_history_count
      FROM products
    `),
    getNutritionCrawlStatus(),
  ]);

  const agg = aggregateRow.rows[0];

  res.json({
    chains: chainRows.rows.map((r) => ({
      key: r.key,
      displayName: r.display_name,
      productCount: Number(r.product_count),
      lastCheckedAt: r.last_checked_at,
    })),
    catalog: {
      totalProducts: Number(agg.total_products),
      onOfferCount: Number(agg.on_offer_count),
      avgDiscountPercent: agg.avg_discount_percent !== null ? Number(agg.avg_discount_percent) : null,
      categoryCount: Number(agg.category_count),
      priceHistoryCount: Number(agg.price_history_count),
    },
    nutritionCrawl,
    ingest: getIngestStatus(),
  });
});

export default router;
