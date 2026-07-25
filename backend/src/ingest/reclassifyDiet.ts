import { pool } from "../db/pool.js";
import { classifyDiet } from "./dietClassifier.js";
import { mapWithConcurrency } from "./concurrency.js";

// Re-runs the diet classifier over ingredient text that's already cached in
// product_details — no network calls, so this is safe to run as often as
// needed while iterating on the dictionaries in dietClassifier.ts. Much
// higher concurrency than the nutrition crawler is fine here: we're not
// hitting the storefront, just local Postgres + CPU.
const RECLASSIFY_CONCURRENCY = 50;

export interface ReclassifySummary {
  processed: number;
  withFlags: number;
  noIngredients: number;
  durationMs: number;
}

let running = false;

export function isReclassifyRunning(): boolean {
  return running;
}

export async function reclassifyAllDiet(): Promise<ReclassifySummary> {
  if (running) {
    throw new Error("Reclassify already in progress");
  }
  running = true;
  const start = Date.now();

  try {
    const { rows } = await pool.query<{ id: number; ingredients: string | null }>(
      `SELECT p.id, d.ingredients FROM products p JOIN product_details d ON d.product_id = p.id`,
    );

    let withFlags = 0;
    let noIngredients = 0;

    await mapWithConcurrency(rows, RECLASSIFY_CONCURRENCY, async (row) => {
      const diet = classifyDiet(row.ingredients);
      if (diet.parseStatus === "no_ingredients") noIngredients++;
      if (diet.flags.length > 0) withFlags++;
      await pool.query(
        `UPDATE products SET contains_diet_flags = $2, diet_parse_status = $3, diet_unmatched_tokens = $4 WHERE id = $1`,
        [row.id, diet.flags, diet.parseStatus, diet.unmatchedTokens],
      );
    });

    return { processed: rows.length, withFlags, noIngredients, durationMs: Date.now() - start };
  } finally {
    running = false;
  }
}
