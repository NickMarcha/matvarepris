import { Router } from "express";
import { pool } from "../db/pool.js";
import { reclassifyAllDiet, isReclassifyRunning } from "../ingest/reclassifyDiet.js";

const router = Router();

// The actual worklist for improving dietClassifier.ts's dictionaries: the
// most frequent tokens across the whole corpus that matched nothing. Ranked
// by frequency since ingredient vocabulary is fairly repetitive — the top
// entries here have outsized impact per dictionary addition.
router.get("/diet-classification/report", async (_req, res) => {
  const [counts, topUnmatched] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE diet_parse_status IS NOT NULL) AS classified_count,
        COUNT(*) FILTER (WHERE diet_parse_status = 'no_ingredients') AS no_ingredients_count,
        COUNT(*) FILTER (WHERE 'kjott' = ANY(contains_diet_flags)) AS meat_count,
        COUNT(*) FILTER (WHERE 'gelatin' = ANY(contains_diet_flags)) AS gelatin_count,
        COUNT(*) FILTER (WHERE 'honning' = ANY(contains_diet_flags)) AS honey_count
      FROM products
    `),
    pool.query(`
      SELECT token, COUNT(*) AS count
      FROM products, unnest(diet_unmatched_tokens) AS token
      GROUP BY token
      ORDER BY count DESC
      LIMIT 50
    `),
  ]);

  const c = counts.rows[0];
  res.json({
    classifiedCount: Number(c.classified_count),
    noIngredientsCount: Number(c.no_ingredients_count),
    meatCount: Number(c.meat_count),
    gelatinCount: Number(c.gelatin_count),
    honeyCount: Number(c.honey_count),
    topUnmatchedTokens: topUnmatched.rows.map((r) => ({ token: r.token, count: Number(r.count) })),
  });
});

router.post("/diet-classification/reclassify", (_req, res) => {
  if (isReclassifyRunning()) {
    res.status(409).json({ error: "Reclassify already in progress" });
    return;
  }
  reclassifyAllDiet().catch((err) => console.error("[diet-classification] reclassify failed:", err));
  res.status(202).json({ message: "Reclassify started" });
});

export default router;
