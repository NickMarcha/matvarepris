import { pool } from "../db/pool.js";
import { KASSALAPP_STORES, NGDATA_STORE_CODES } from "../chains.js";
import { BULK_MAX_EANS, fetchBulkPrices, type KassalappBulkItem } from "./kassalappClient.js";
import { mapWithConcurrency } from "./concurrency.js";
import type { IngestSummary } from "./ingestChain.js";

// Prices for chains NorgesGruppen's API doesn't cover, from Kassalapp. Runs
// after the ngdata ingest, for the EANs that ingest already knows: one
// products row per (Kassalapp chain, EAN), same price_history change
// detection. Kassalapp rows carry only title and price. Nutrition, category
// and images stay on the ngdata rows, which always win the per-EAN
// "representative" pick because Kassalapp rows are never crawled.

const API_KEY = process.env.KASSALAPP_API_KEY ?? "";
// A store's price older than this is not taken (Kassalapp still lists Kiwi
// and Coop prices last updated in 2024).
const MAX_AGE_DAYS = Number(process.env.KASSALAPP_MAX_AGE_DAYS ?? 7);
const BACKFILL_DAYS = 90; // free tier maximum; first run only
const DAILY_DAYS = 7;
// Real EANs only. The 4-7 digit codes are NorgesGruppen item codes; another
// chain's code with the same digits can be a different product.
const EAN_SQL_PATTERN = "^[0-9]{8,14}$";
const UPSERT_CONCURRENCY = 10;

export function kassalappEnabled(): boolean {
  return API_KEY !== "";
}

interface BaseRow {
  ean: string;
  compare_unit: string | null;
  content: string | null; // package amount in compare_unit, from the ngdata row's own prices
}

interface Offer {
  chainKey: string;
  ean: string;
  title: string;
  price: number;
  comparePricePerUnit: number | null;
  compareUnit: string | null;
  history: { date: string; price: number }[];
}

// Kassalapp's own unit price is unusable (per ml on Oda, missing on Bunnpris),
// so divide by the package amount. Prefer the amount ngdata's prices imply
// (price / kr per unit), which is in the same unit our other offers compare
// by; fall back to Kassalapp's declared weight.
function packageContent(base: BaseRow, item: KassalappBulkItem): { amount: number; unit: string } | null {
  const fromNgdata = base.content !== null ? Number(base.content) : null;
  if (fromNgdata && fromNgdata > 0 && base.compare_unit) return { amount: fromNgdata, unit: base.compare_unit };
  const w = item.weight;
  if (!w || w <= 0 || !item.weight_unit) return null;
  switch (item.weight_unit.toLowerCase()) {
    case "g": return { amount: w / 1000, unit: "kg" };
    case "kg": return { amount: w, unit: "kg" };
    case "ml": return { amount: w / 1000, unit: "l" };
    case "cl": return { amount: w / 100, unit: "l" };
    case "dl": return { amount: w / 10, unit: "l" };
    case "l": return { amount: w, unit: "l" };
    default: return null;
  }
}

function numsDiffer(a: string | null, b: number | null): boolean {
  const an = a === null ? null : Number(a);
  if (an === null && b === null) return false;
  if (an === null || b === null) return true;
  return Math.abs(an - b) > 0.001;
}

// One point per price level: Kassalapp gives one per day, we store changes.
function collapseHistory(points: { date: string; price: number }[]): { date: string; price: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; price: number }[] = [];
  for (const p of sorted) {
    if (out.length === 0 || Math.abs(out[out.length - 1].price - p.price) > 0.001) out.push(p);
  }
  return out;
}

async function upsertOffer(o: Offer, content: number | null): Promise<"inserted" | "changed" | "unchanged"> {
  const existing = await pool.query<{ current_price: string | null; current_compare_price_per_unit: string | null; is_for_sale: boolean }>(
    `SELECT current_price, current_compare_price_per_unit, is_for_sale FROM products WHERE chain_key = $1 AND ean = $2`,
    [o.chainKey, o.ean],
  );
  const prev = existing.rows[0];

  const result = await pool.query<{ id: number }>(
    `INSERT INTO products (chain_key, ean, title, compare_unit, current_price, current_compare_price_per_unit,
                           is_offer, is_out_of_stock, is_for_sale)
     VALUES ($1, $2, $3, $4, $5, $6, false, false, true)
     ON CONFLICT (chain_key, ean) DO UPDATE SET
       title = EXCLUDED.title,
       compare_unit = EXCLUDED.compare_unit,
       current_price = EXCLUDED.current_price,
       current_compare_price_per_unit = EXCLUDED.current_compare_price_per_unit,
       is_out_of_stock = false,
       is_for_sale = true,
       last_seen_at = now(),
       last_checked_at = now()
     RETURNING id`,
    [o.chainKey, o.ean, o.title, o.compareUnit, o.price, o.comparePricePerUnit],
  );
  const productId = result.rows[0].id;

  if (!prev) {
    for (const point of collapseHistory(o.history)) {
      await pool.query(
        `INSERT INTO price_history (product_id, changed_at, price, compare_price_per_unit, is_offer, is_out_of_stock, is_for_sale)
         VALUES ($1, $2::date, $3, $4, false, false, true)`,
        [productId, point.date, point.price, content ? Math.round((point.price / content) * 100) / 100 : null],
      );
    }
    return "inserted";
  }

  const changed =
    numsDiffer(prev.current_price, o.price) ||
    numsDiffer(prev.current_compare_price_per_unit, o.comparePricePerUnit) ||
    !prev.is_for_sale;
  if (!changed) return "unchanged";

  await pool.query(
    `INSERT INTO price_history (product_id, price, compare_price_per_unit, is_offer, is_out_of_stock, is_for_sale)
     VALUES ($1, $2, $3, false, false, true)`,
    [productId, o.price, o.comparePricePerUnit],
  );
  return "changed";
}

export async function ingestKassalapp(): Promise<IngestSummary> {
  const start = Date.now();
  const summary: IngestSummary = {
    chain: "kassalapp",
    totalSeen: 0,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    durationMs: 0,
  };

  const runStarted = (await pool.query<{ now: Date }>(`SELECT now()`)).rows[0].now;
  const hasRows = await pool.query(
    `SELECT 1 FROM products p JOIN chains c ON c.key = p.chain_key WHERE c.source = 'kassalapp' LIMIT 1`,
  );
  const days = hasRows.rows.length > 0 ? DAILY_DAYS : BACKFILL_DAYS;

  // Prefer a row that has a unit price, so the package amount can be derived.
  const baseResult = await pool.query<BaseRow>(
    `SELECT DISTINCT ON (p.ean) p.ean, p.compare_unit,
            CASE WHEN p.current_price > 0 AND p.current_compare_price_per_unit > 0
                 THEN p.current_price / p.current_compare_price_per_unit END AS content
     FROM products p JOIN chains c ON c.key = p.chain_key
     WHERE c.source = 'ngdata' AND p.ean ~ $1
     ORDER BY p.ean, (p.current_compare_price_per_unit > 0) DESC NULLS LAST, p.last_seen_at DESC`,
    [EAN_SQL_PATTERN],
  );
  const bases = new Map(baseResult.rows.map((r) => [r.ean, r]));
  const eans = [...bases.keys()];
  console.log(`[kassalapp] ${eans.length} EANs, ${Math.ceil(eans.length / BULK_MAX_EANS)} calls, ${days} days of history`);

  const freshAfter = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
  const knownChains = new Set<string>();
  const unknownCodes = new Map<string, number>();
  const answeredEans: string[] = [];

  for (let i = 0; i < eans.length; i += BULK_MAX_EANS) {
    const batch = eans.slice(i, i + BULK_MAX_EANS);
    let items: KassalappBulkItem[];
    try {
      items = await fetchBulkPrices(API_KEY, batch, days);
    } catch (err) {
      console.error(`[kassalapp] batch ${i / BULK_MAX_EANS} failed:`, err);
      summary.errors++;
      continue;
    }
    answeredEans.push(...batch);

    const work: { offer: Offer; content: number | null }[] = [];
    for (const item of items) {
      const base = bases.get(item.ean);
      if (!base) continue;
      const pkg = packageContent(base, item);
      for (const s of item.stores) {
        if (NGDATA_STORE_CODES.has(s.store)) continue;
        const target = KASSALAPP_STORES[s.store];
        if (!target) {
          unknownCodes.set(s.store, (unknownCodes.get(s.store) ?? 0) + 1);
          continue;
        }
        const price = s.current_price === null ? null : Number(s.current_price);
        const checked = s.last_checked ? Date.parse(s.last_checked) : NaN;
        if (!price || price <= 0 || !(checked >= freshAfter)) continue;

        if (!knownChains.has(target.key)) {
          await pool.query(
            `INSERT INTO chains (key, chain_id, display_name, source) VALUES ($1, NULL, $2, 'kassalapp')
             ON CONFLICT (key) DO NOTHING`,
            [target.key, target.displayName],
          );
          knownChains.add(target.key);
        }

        work.push({
          content: pkg?.amount ?? null,
          offer: {
            chainKey: target.key,
            ean: item.ean,
            title: item.name.trim(),
            price,
            comparePricePerUnit: pkg ? Math.round((price / pkg.amount) * 100) / 100 : null,
            compareUnit: pkg?.unit ?? null,
            history: item.price_history.filter((h) => h.store === s.store),
          },
        });
      }
    }

    const outcomes = await mapWithConcurrency(work, UPSERT_CONCURRENCY, async ({ offer, content }) => {
      try {
        return await upsertOffer(offer, content);
      } catch (err) {
        console.error(`[kassalapp] failed to upsert ${offer.chainKey} ean=${offer.ean}:`, err);
        return "error" as const;
      }
    });
    for (const outcome of outcomes) {
      summary.totalSeen++;
      if (outcome === "error") summary.errors++;
      else summary[outcome]++;
    }
  }

  // An EAN we asked about whose store no longer lists it (or whose price went
  // stale) is no longer for sale there. Only for batches that answered, so a
  // failed call doesn't mark a whole batch as gone.
  const gone = await pool.query(
    `WITH gone AS (
       UPDATE products p SET is_for_sale = false, last_checked_at = now()
       FROM chains c
       WHERE c.key = p.chain_key AND c.source = 'kassalapp'
         AND p.ean = ANY($1) AND p.last_seen_at < $2 AND p.is_for_sale
       RETURNING p.id, p.current_price, p.current_compare_price_per_unit
     )
     INSERT INTO price_history (product_id, price, compare_price_per_unit, is_offer, is_out_of_stock, is_for_sale)
     SELECT id, current_price, current_compare_price_per_unit, false, false, false FROM gone`,
    [answeredEans, runStarted],
  );
  if (gone.rowCount) console.log(`[kassalapp] ${gone.rowCount} offers no longer listed, marked not for sale`);
  if (unknownCodes.size > 0) {
    console.log(`[kassalapp] store codes not mapped in chains.ts:`, Object.fromEntries(unknownCodes));
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
