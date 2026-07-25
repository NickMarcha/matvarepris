import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/categories", async (req, res) => {
  const { chain } = req.query as Record<string, string | undefined>;

  const conditions: string[] = ["category_name IS NOT NULL"];
  const params: unknown[] = [];

  if (chain) {
    const chains = chain.split(",").map((c) => c.trim()).filter(Boolean);
    if (chains.length > 0) {
      params.push(chains);
      conditions.push(`chain_key = ANY($${params.length})`);
    }
  }

  const result = await pool.query(
    `SELECT category_name, chain_key, COUNT(*) AS count
     FROM products
     WHERE ${conditions.join(" AND ")}
     GROUP BY category_name, chain_key
     ORDER BY chain_key ASC, category_name ASC`,
    params,
  );

  res.json(
    result.rows.map((r) => ({ name: r.category_name, chain: r.chain_key, count: Number(r.count) })),
  );
});

export default router;
