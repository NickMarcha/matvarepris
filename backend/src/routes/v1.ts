import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { eanHistoryHandler, queryGroupedProducts, toApiProduct } from "./products.js";

// The versioned API for other programs (docs/api.md is its contract). The
// unversioned /api routes stay shaped for this repo's own frontend and can
// change with it; nothing here should change shape without bumping the
// guide's contract version.
//
// Everything is keyed by EAN: one item per barcode, with one offer per chain
// that sells it. Internal product ids differ per chain and are only exposed
// inside offers.

const router = Router();

// src/routes/v1.ts and dist/routes/v1.js both sit two levels below the
// backend root, where docs/ lives.
const GUIDE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "api.md");

const EAN_PATTERN = /^\d{8,14}$/;
const LOOKUP_MAX_EANS = 200;
const CHANGES_DEFAULT_LIMIT = 500;
const CHANGES_MAX_LIMIT = 2000;

function chainList(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((c) => c.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((c): c is string => typeof c === "string" && c.length > 0);
  return [];
}

// Same choice as the grouped SQL in products.ts: the row whose nutrition was
// crawled most recently, then the lowest id.
function representative(rows: any[]): any {
  return [...rows].sort((a, b) => {
    const at = a.nutrition_fetched_at ? new Date(a.nutrition_fetched_at).getTime() : -Infinity;
    const bt = b.nutrition_fetched_at ? new Date(b.nutrition_fetched_at).getTime() : -Infinity;
    if (at !== bt) return bt - at;
    return Number(a.id) - Number(b.id);
  })[0];
}

function toOffer(row: any) {
  const p = toApiProduct(row);
  return {
    chain: p.chain,
    productId: Number(p.id),
    price: p.price,
    comparePricePerUnit: p.comparePricePerUnit,
    compareUnit: p.compareUnit,
    isOffer: p.isOffer,
    originalPrice: p.originalPrice,
    discountPercent: p.discountPercent,
    promotionName: p.promotionName,
    inStock: !p.isOutOfStock && p.isForSale,
    productUrl: p.productUrl,
    checkedAt: row.last_checked_at,
  };
}

// How much is in the package, in the unit the price is compared by. The
// stored `weight` is no good for this: it's the shipping mass even for
// drinks (a 450 ml tub reports 0.269). price / comparePricePerUnit is what
// the store itself divided by.
function contentOf(offers: ReturnType<typeof toOffer>[]) {
  for (const o of offers) {
    if (o.price && o.comparePricePerUnit && o.compareUnit) {
      return { amount: Math.round((o.price / o.comparePricePerUnit) * 1000) / 1000, unit: o.compareUnit };
    }
  }
  return null;
}

function toItem(rows: any[]) {
  const repRow = representative(rows);
  const rep = toApiProduct(repRow);
  const offers = rows
    .map(toOffer)
    .sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  const crawled = repRow.nutrition_fetched_at != null;
  return {
    ean: rep.ean,
    title: rep.title,
    subtitle: rep.subtitle,
    brand: rep.brand,
    category: rep.category,
    imageUrl: rep.imageUrl,
    content: contentOf(offers),
    // null means not crawled yet, not "has none".
    nutrition: crawled ? rep.nutrition : null,
    allergens: (repRow.contains_allergens as string[] | null) ?? null,
    dietFlags: (repRow.contains_diet_flags as string[] | null) ?? null,
    offers,
  };
}

async function rowsByEan(eans: string[], chains: string[]): Promise<Map<string, any[]>> {
  const params: unknown[] = [eans];
  let chainCondition = "";
  if (chains.length > 0) {
    params.push(chains);
    chainCondition = "AND chain_key = ANY($2)";
  }
  const result = await pool.query(`SELECT * FROM products WHERE ean = ANY($1) ${chainCondition}`, params);
  const byEan = new Map<string, any[]>();
  for (const row of result.rows) {
    const list = byEan.get(row.ean) ?? [];
    list.push(row);
    byEan.set(row.ean, list);
  }
  return byEan;
}

router.get("/info", (_req, res) => {
  let guide: string;
  try {
    guide = fs.readFileSync(GUIDE_PATH, "utf8");
  } catch {
    res.status(500).json({ error: "API guide missing from this build" });
    return;
  }
  const version = Number(guide.match(/^Contract version:\s*(\d+)/m)?.[1]);
  res.json({ contractVersion: version, guide });
});

router.get("/products", async (req, res) => {
  const result = await queryGroupedProducts(req.query as Record<string, string | undefined>);
  res.json({
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: result.rows.map((r) => toItem(r.members)),
  });
});

router.post("/products/lookup", async (req, res) => {
  const eans: unknown = req.body?.eans;
  if (!Array.isArray(eans) || eans.length === 0) {
    res.status(400).json({ error: "Body must be { \"eans\": [\"7038010002274\", ...] }" });
    return;
  }
  if (eans.length > LOOKUP_MAX_EANS) {
    res.status(400).json({ error: `At most ${LOOKUP_MAX_EANS} EANs per request` });
    return;
  }
  const invalid = eans.filter((e) => typeof e !== "string" || !EAN_PATTERN.test(e));
  if (invalid.length > 0) {
    res.status(400).json({ error: "EANs must be strings of 8-14 digits", invalid });
    return;
  }

  const unique = [...new Set(eans as string[])];
  const byEan = await rowsByEan(unique, chainList(req.body?.chains));
  res.json({
    items: unique.filter((e) => byEan.has(e)).map((e) => toItem(byEan.get(e)!)),
    missing: unique.filter((e) => !byEan.has(e)),
  });
});

router.get("/products/:ean", async (req, res) => {
  const { ean } = req.params;
  if (!EAN_PATTERN.test(ean)) {
    res.status(400).json({ error: "EAN must be 8-14 digits" });
    return;
  }
  const rows = (await rowsByEan([ean], chainList(req.query.chain))).get(ean);
  if (!rows) {
    res.status(404).json({ error: "No product with this EAN" });
    return;
  }
  res.json(toItem(rows));
});

router.get("/products/:ean/history", eanHistoryHandler);

// Cursor is "<txid>.<seq>"; see migration 0007 for why both parts are needed.
const CURSOR_PATTERN = /^(\d+)\.(\d+)$/;
// Only rows whose writing transaction finished before every transaction
// still running; anything newer waits for the next call.
const SETTLED = "change_txid < pg_snapshot_xmin(pg_current_snapshot())";

router.get("/changes", async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  const limit = Math.min(
    CHANGES_MAX_LIMIT,
    Math.max(1, parseInt(String(req.query.limit ?? CHANGES_DEFAULT_LIMIT), 10) || CHANGES_DEFAULT_LIMIT),
  );

  if (since === "latest") {
    const head = await pool.query(
      `SELECT change_txid::text AS txid, change_seq FROM products WHERE ${SETTLED}
       ORDER BY change_txid DESC, change_seq DESC LIMIT 1`,
    );
    const row = head.rows[0];
    res.json({ cursor: row ? `${row.txid}.${row.change_seq}` : "0.0", hasMore: false, changes: [] });
    return;
  }

  const match = CURSOR_PATTERN.exec(since || "0.0");
  if (!match) {
    res.status(400).json({ error: "since must be a cursor from a previous response, or \"latest\"" });
    return;
  }

  const result = await pool.query(
    `SELECT ean, chain_key, change_txid::text AS txid, change_seq, change_kinds
     FROM products
     WHERE (change_txid, change_seq) > ($1::xid8, $2::bigint) AND ${SETTLED}
     ORDER BY change_txid, change_seq
     LIMIT $3`,
    [match[1], match[2], limit + 1],
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  res.json({
    cursor: last ? `${last.txid}.${last.change_seq}` : `${match[1]}.${match[2]}`,
    hasMore,
    changes: rows.map((r) => ({ ean: r.ean, chain: r.chain_key, kinds: r.change_kinds })),
  });
});

export default router;
