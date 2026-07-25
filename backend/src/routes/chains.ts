import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/chains", async (_req, res) => {
  const result = await pool.query(`
    SELECT c.key, c.display_name, COUNT(p.id) AS product_count, MAX(p.last_checked_at) AS last_checked_at
    FROM chains c
    LEFT JOIN products p ON p.chain_key = c.key
    GROUP BY c.key, c.display_name
    ORDER BY c.display_name ASC
  `);

  res.json(
    result.rows.map((r) => ({
      key: r.key,
      displayName: r.display_name,
      productCount: Number(r.product_count),
      lastCheckedAt: r.last_checked_at,
    })),
  );
});

export default router;
