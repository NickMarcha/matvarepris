import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { cachedCatalog, lookupCatalog, SourcesDown, type CatalogProduct } from "../catalog/catalog.js";
import { identifyClient, requireClient } from "../clientAuth.js";
import { addReports, deleteReporter, REPORT_MAX_BACKDATE_DAYS } from "../reported/reported.js";
import { eanHistoryHandler, queryGroupedProducts, toApiProduct } from "./products.js";
import { buildOpenApi } from "./v1OpenApi.js";
import {
  EAN_PATTERN,
  LOOKUP_MAX_EANS,
  PriceReportRequest,
  type ChangePageT,
  type ContentT,
  type ItemT,
  type NutritionT,
  type OfferT,
  type PriceReportResponseT,
} from "./v1Schemas.js";

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

type ChainSources = Map<string, string>;
type OfferSource = OfferT["source"];

// chains is a handful of rows; read it per request rather than caching, so a
// chain the ingest just added is never missing.
async function chainSources(): Promise<ChainSources> {
  const result = await pool.query<{ key: string; source: string }>(`SELECT key, source FROM chains`);
  return new Map(result.rows.map((r) => [r.key, r.source]));
}

function toOffer(row: any, sources: ChainSources): OfferT {
  const p = toApiProduct(row);
  return {
    chain: p.chain,
    source: (sources.get(row.chain_key) ?? "ngdata") as OfferSource,
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
function contentOf(offers: OfferT[]): ContentT | null {
  for (const o of offers) {
    if (o.price && o.comparePricePerUnit && o.compareUnit) {
      return { amount: Math.round((o.price / o.comparePricePerUnit) * 1000) / 1000, unit: o.compareUnit };
    }
  }
  return null;
}

function catalogNutrition(c: CatalogProduct): NutritionT | null {
  const n = c.nutrition;
  if (!n) return null;
  const kcal = n.kcal;
  const share = (grams: number | null, perGram: number) =>
    grams !== null && kcal !== null && kcal >= 5 ? Math.round(((grams * perGram) / kcal) * 1000) / 10 : null;
  return {
    energyKj: kcal !== null ? Math.round(kcal * 4.184) : null,
    energyKcal: kcal,
    fat: n.fat,
    saturatedFat: n.saturatedFat,
    monounsaturatedFat: null,
    polyunsaturatedFat: null,
    carbs: n.carbs,
    netCarbs: n.carbs !== null ? Math.max(0, Math.round((n.carbs - (n.fiber ?? 0)) * 10) / 10) : null,
    sugars: n.sugars,
    sugarAlcohols: null,
    starch: null,
    fiber: n.fiber,
    protein: n.protein,
    salt: n.salt,
    proteinPercent: share(n.protein, 4),
    carbsPercent: share(n.carbs, 4),
    fatPercent: share(n.fat, 9),
    fetchedAt: c.fetchedAt,
  };
}

function catalogContent(c: CatalogProduct | undefined): ContentT | null {
  return c?.contentAmount && c.contentUnit ? { amount: c.contentAmount, unit: c.contentUnit } : null;
}

// A barcode no chain we read sells, known only from the catalog.
function catalogItem(c: CatalogProduct): ItemT {
  return {
    ean: c.ean,
    title: c.title,
    subtitle: c.quantityText,
    brand: c.brand,
    category: null,
    imageUrl: c.imageUrl,
    content: catalogContent(c),
    nutrition: catalogNutrition(c),
    allergens: null,
    dietFlags: null,
    offers: [],
    infoSource: c.source,
  };
}

function toItem(rows: any[], sources: ChainSources, catalog: Map<string, CatalogProduct>): ItemT {
  const repRow = representative(rows);
  const rep = toApiProduct(repRow);
  const offers = rows
    .map((r) => toOffer(r, sources))
    .sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  const crawled = repRow.nutrition_fetched_at != null;
  const fromStore = rows.some((r) => sources.get(r.chain_key) === "ngdata");
  // Sold only at Kassalapp or reported chains: the catalog says more about
  // what it is than those rows (which carry a title and a price).
  const cat = fromStore ? undefined : catalog.get(rep.ean);
  return {
    ean: rep.ean,
    title: rep.title,
    subtitle: rep.subtitle,
    brand: rep.brand ?? cat?.brand ?? null,
    category: rep.category,
    imageUrl: rep.imageUrl ?? cat?.imageUrl ?? null,
    content: contentOf(offers) ?? catalogContent(cat),
    // null means not crawled yet, not "has none".
    nutrition: crawled ? rep.nutrition : cat ? catalogNutrition(cat) : null,
    allergens: (repRow.contains_allergens as string[] | null) ?? null,
    dietFlags: (repRow.contains_diet_flags as string[] | null) ?? null,
    offers,
    infoSource: fromStore ? "ngdata" : (cat?.source ?? ((sources.get(repRow.chain_key) ?? "kassalapp") as ItemT["infoSource"])),
  };
}

// Catalog entries for the items that have no ngdata row.
async function catalogFor(groups: any[][], sources: ChainSources): Promise<Map<string, CatalogProduct>> {
  const eans = groups.filter((rows) => !rows.some((r) => sources.get(r.chain_key) === "ngdata")).map((rows) => rows[0].ean);
  return cachedCatalog(eans);
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

function readGuide(): { guide: string; contractVersion: number } | null {
  try {
    const guide = fs.readFileSync(GUIDE_PATH, "utf8");
    return { guide, contractVersion: Number(guide.match(/^Contract version:\s*(\d+)/m)?.[1]) };
  } catch {
    return null;
  }
}

router.get("/info", (_req, res) => {
  const info = readGuide();
  if (!info) {
    res.status(500).json({ error: "API guide missing from this build" });
    return;
  }
  res.json({ contractVersion: info.contractVersion, guide: info.guide });
});

// Built once: it only depends on code and the guide's version line, both
// fixed for the life of the process.
let openApiDoc: ReturnType<typeof buildOpenApi> | null = null;
router.get("/openapi.json", (_req, res) => {
  const info = readGuide();
  if (!info) {
    res.status(500).json({ error: "API guide missing from this build" });
    return;
  }
  openApiDoc ??= buildOpenApi(info.contractVersion);
  res.json(openApiDoc);
});

router.get("/products", async (req, res) => {
  const result = await queryGroupedProducts(req.query as Record<string, string | undefined>);
  const sources = await chainSources();
  const groups = result.rows.map((r) => r.members as any[]);
  const catalog = await catalogFor(groups, sources);
  res.json({
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: groups.map((g) => toItem(g, sources, catalog)),
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
    res.status(400).json({ error: "EANs must be strings of 1-14 digits", invalid });
    return;
  }

  const unique = [...new Set(eans as string[])];
  const chains = chainList(req.body?.chains);
  const byEan = await rowsByEan(unique, chains);
  const sources = await chainSources();
  // Cached catalog entries only: a 200-code lookup must not turn into 200
  // calls elsewhere. With a chain filter, offer-less items don't qualify.
  const catalog = await cachedCatalog(chains.length > 0 ? [...byEan.keys()] : unique);
  const items = unique.flatMap((e) => {
    if (byEan.has(e)) return [toItem(byEan.get(e)!, sources, catalog)];
    const c = catalog.get(e);
    return c ? [catalogItem(c)] : [];
  });
  const found = new Set(items.map((i) => i.ean));
  res.json({ items, missing: unique.filter((e) => !found.has(e)) });
});

router.get("/products/:ean", identifyClient, async (req, res) => {
  const { ean } = req.params;
  if (!EAN_PATTERN.test(ean)) {
    res.status(400).json({ error: "EAN must be 1-14 digits" });
    return;
  }
  const chains = chainList(req.query.chain);
  const rows = (await rowsByEan([ean], chains)).get(ean);
  const sources = await chainSources();
  if (rows) {
    res.json(toItem(rows, sources, await catalogFor([rows], sources)));
    return;
  }
  // Not sold by a chain we read. Clients with a key (they spend the shared
  // Kassalapp budget) get it looked up; everyone gets what's cached. Real
  // barcodes only: short codes are NorgesGruppen item numbers.
  let c: CatalogProduct | null | undefined = null;
  if (chains.length === 0 && /^\d{8,14}$/.test(ean)) {
    if (res.locals.client) {
      try {
        c = await lookupCatalog(ean);
      } catch (err) {
        if (!(err instanceof SourcesDown)) throw err;
        res.status(503).json({ error: err.message, sourcesDown: err.sources });
        return;
      }
    } else {
      c = (await cachedCatalog([ean])).get(ean);
    }
  }
  if (!c) {
    res.status(404).json({ error: "No product with this EAN" });
    return;
  }
  res.json(catalogItem(c));
});

router.get("/products/:ean/history", eanHistoryHandler);

// Prices people saw, sent by a client app on their behalf (#124).
router.post("/prices", requireClient, async (req, res) => {
  const parsed = PriceReportRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid price report", invalid: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    return;
  }
  const { reporter, reports } = parsed.data;
  // Calendar days in Norway, where the shops are.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  const oldest = new Date(Date.parse(today) - REPORT_MAX_BACKDATE_DAYS * 86400_000).toISOString().slice(0, 10);
  const badDate: PriceReportResponseT["rejected"] = [];
  const valid = reports.flatMap((r, index) => {
    if (Number.isNaN(Date.parse(r.observedOn)) || r.observedOn > today || r.observedOn < oldest) {
      badDate.push({ index, reason: "badDate" });
      return [];
    }
    return [{ ...r, index }];
  });
  const result = await addReports(res.locals.client, reporter, valid);
  const body: PriceReportResponseT = {
    accepted: result.accepted,
    rejected: [...badDate, ...result.rejected.map((r) => ({ index: valid[r.index].index, reason: r.reason }))].sort(
      (a, b) => a.index - b.index,
    ),
  };
  res.json(body);
});

router.delete("/prices/reporters/:reporter", requireClient, async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(req.params.reporter)) {
    res.status(400).json({ error: "Invalid reporter id" });
    return;
  }
  res.json({ deleted: await deleteReporter(res.locals.client, req.params.reporter) });
});

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
    const page: ChangePageT = { cursor: row ? `${row.txid}.${row.change_seq}` : "0.0", hasMore: false, changes: [] };
    res.json(page);
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
  const page: ChangePageT = {
    cursor: last ? `${last.txid}.${last.change_seq}` : `${match[1]}.${match[2]}`,
    hasMore,
    changes: rows.map((r) => ({ ean: r.ean, chain: r.chain_key, kinds: r.change_kinds })),
  };
  res.json(page);
});

export default router;
