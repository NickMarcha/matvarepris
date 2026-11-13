import { pool } from "../db/pool.js";
import { lookupCatalog, SourcesDown } from "../catalog/catalog.js";

// Prices people report through a client app (#124). Every report is kept in
// reported_prices; for chains whose only source is reports
// (chains.source = 'reported'), the newest report from the last
// REPORT_MAX_AGE_DAYS becomes that chain's products row, so it shows up as a
// normal offer. For chains we read directly (ngdata, Kassalapp) reports are
// kept but never override the store's own price.

export const REPORT_MAX_AGE_DAYS = 60;
// How far back a report may be dated when it comes in.
export const REPORT_MAX_BACKDATE_DAYS = 90;

export type PriceReport = {
  ean: string;
  chain: string;
  price: number;
  observedOn: string; // YYYY-MM-DD
  kind: "receipt" | "shelf";
};

export type Rejection = { index: number; reason: "unknownChain" | "unknownProduct" | "tryAgain" };

async function reportedChains(): Promise<Map<string, string>> {
  const result = await pool.query<{ key: string; source: string }>(`SELECT key, source FROM chains`);
  return new Map(result.rows.map((r) => [r.key, r.source]));
}

// Title and package amount for a new reported row: from a chain we read
// directly when one sells the EAN, else the catalog.
async function identity(ean: string): Promise<{ title: string; subtitle: string | null; brand: string | null; compareUnit: string | null; content: number | null } | null> {
  const store = await pool.query(
    `SELECT p.title, p.subtitle, p.brand, p.compare_unit,
            CASE WHEN p.current_compare_price_per_unit > 0 THEN p.current_price / p.current_compare_price_per_unit END AS content
     FROM products p JOIN chains c ON c.key = p.chain_key
     WHERE p.ean = $1 AND c.source <> 'reported'
     ORDER BY (c.source = 'ngdata') DESC, (p.current_compare_price_per_unit IS NOT NULL) DESC, p.id
     LIMIT 1`,
    [ean],
  );
  const s = store.rows[0];
  if (s) return { title: s.title, subtitle: s.subtitle, brand: s.brand, compareUnit: s.compare_unit, content: s.content === null ? null : Number(s.content) };
  const c = await lookupCatalog(ean); // may throw SourcesDown
  if (!c) return null;
  return { title: c.title, subtitle: c.quantityText, brand: c.brand, compareUnit: c.contentUnit, content: c.contentAmount };
}

// Brings one (chain, EAN) products row in line with its reports.
export async function refreshOffer(chain: string, ean: string): Promise<void> {
  const latest = await pool.query<{ price: string; observed_on: string }>(
    `SELECT price, observed_on::text FROM reported_prices
     WHERE chain_key = $1 AND ean = $2 AND observed_on >= current_date - $3::int
     ORDER BY observed_on DESC, created_at DESC LIMIT 1`,
    [chain, ean, REPORT_MAX_AGE_DAYS],
  );
  const existing = await pool.query<{ id: string; current_price: string | null; is_for_sale: boolean }>(
    `SELECT id, current_price, is_for_sale FROM products WHERE chain_key = $1 AND ean = $2`,
    [chain, ean],
  );
  const prev = existing.rows[0];
  const report = latest.rows[0];

  if (!report) {
    if (!prev) return;
    const any = await pool.query(`SELECT 1 FROM reported_prices WHERE chain_key = $1 AND ean = $2 LIMIT 1`, [chain, ean]);
    if (any.rowCount === 0) {
      // Every report behind it was deleted: the row and its history go too.
      await pool.query(`DELETE FROM products WHERE id = $1`, [prev.id]);
    } else if (prev.is_for_sale) {
      // Too old to trust, but keep the history.
      await pool.query(`UPDATE products SET is_for_sale = false WHERE id = $1`, [prev.id]);
      await pool.query(
        `INSERT INTO price_history (product_id, price, compare_price_per_unit, is_offer, is_out_of_stock, is_for_sale)
         SELECT id, current_price, current_compare_price_per_unit, false, false, false FROM products WHERE id = $1`,
        [prev.id],
      );
    }
    return;
  }

  const who = await identity(ean);
  if (!who) return;
  const price = Number(report.price);
  const compare = who.content && who.content > 0 ? Math.round((price / who.content) * 100) / 100 : null;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO products (chain_key, ean, title, subtitle, brand, compare_unit, current_price, current_compare_price_per_unit,
                           is_offer, is_out_of_stock, is_for_sale, first_seen_at, last_seen_at, last_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false, true, $9::date, $9::date, $9::date)
     ON CONFLICT (chain_key, ean) DO UPDATE SET
       title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, brand = EXCLUDED.brand,
       compare_unit = EXCLUDED.compare_unit, current_price = EXCLUDED.current_price,
       current_compare_price_per_unit = EXCLUDED.current_compare_price_per_unit,
       is_out_of_stock = false, is_for_sale = true,
       last_seen_at = EXCLUDED.last_seen_at, last_checked_at = EXCLUDED.last_checked_at
     RETURNING id`,
    [chain, ean, who.title, who.subtitle, who.brand, who.compareUnit, price, compare, report.observed_on],
  );
  const changed = !prev || !prev.is_for_sale || prev.current_price === null || Math.abs(Number(prev.current_price) - price) > 0.001;
  if (changed) {
    await pool.query(
      `INSERT INTO price_history (product_id, changed_at, price, compare_price_per_unit, is_offer, is_out_of_stock, is_for_sale)
       VALUES ($1, $2::date, $3, $4, false, false, true)`,
      [result.rows[0].id, report.observed_on, price, compare],
    );
  }
}

// Stores the reports that can be placed and returns the rest with a reason.
// Validation of shape (EAN pattern, price range, date window) is the route's.
export async function addReports(client: string, reporter: string, reports: PriceReport[]): Promise<{ accepted: number; rejected: Rejection[] }> {
  const chains = await reportedChains();
  const rejected: Rejection[] = [];
  const known = new Map<string, boolean | "down">();
  const touched = new Set<string>();
  let accepted = 0;

  for (const [index, r] of reports.entries()) {
    if (!chains.has(r.chain)) {
      rejected.push({ index, reason: "unknownChain" });
      continue;
    }
    if (!known.has(r.ean)) {
      try {
        known.set(r.ean, (await identity(r.ean)) !== null);
      } catch (err) {
        if (!(err instanceof SourcesDown)) throw err;
        known.set(r.ean, "down");
      }
    }
    const k = known.get(r.ean);
    if (k !== true) {
      rejected.push({ index, reason: k === "down" ? "tryAgain" : "unknownProduct" });
      continue;
    }
    await pool.query(
      `INSERT INTO reported_prices (ean, chain_key, price, observed_on, kind, client, reporter) VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
      [r.ean, r.chain, r.price, r.observedOn, r.kind, client, reporter],
    );
    accepted++;
    if (chains.get(r.chain) === "reported") touched.add(`${r.chain}\u0000${r.ean}`);
  }
  for (const t of touched) {
    const [chain, ean] = t.split("\u0000");
    await refreshOffer(chain, ean);
  }
  return { accepted, rejected };
}

// Deletes everything one reporter sent through this client, and rebuilds the
// offers those reports fed.
export async function deleteReporter(client: string, reporter: string): Promise<number> {
  const deleted = await pool.query<{ chain_key: string; ean: string }>(
    `DELETE FROM reported_prices WHERE client = $1 AND reporter = $2 RETURNING chain_key, ean`,
    [client, reporter],
  );
  const chains = await reportedChains();
  const seen = new Set<string>();
  for (const r of deleted.rows) {
    const key = `${r.chain_key}\u0000${r.ean}`;
    if (seen.has(key) || chains.get(r.chain_key) !== "reported") continue;
    seen.add(key);
    await refreshOffer(r.chain_key, r.ean);
  }
  return deleted.rowCount ?? 0;
}

// Daily, after the ingest: reported offers whose newest report has aged out.
export async function expireReported(): Promise<number> {
  const stale = await pool.query<{ chain_key: string; ean: string }>(
    `SELECT p.chain_key, p.ean FROM products p JOIN chains c ON c.key = p.chain_key
     WHERE c.source = 'reported' AND p.is_for_sale AND p.last_checked_at < current_date - $1::int`,
    [REPORT_MAX_AGE_DAYS],
  );
  for (const r of stale.rows) await refreshOffer(r.chain_key, r.ean);
  return stale.rowCount ?? 0;
}
