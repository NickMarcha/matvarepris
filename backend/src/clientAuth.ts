import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

// Keys for client apps that may report prices and make the server look
// barcodes up elsewhere (Kassalapp, Open Food Facts) on a miss. Both cost
// something (data people trust, a shared rate limit), so they need a key;
// reading stays open. REPORT_API_KEYS is "name:key,name:key", e.g.
// "susdi:<64 hex>". The name is stored with each report.
const CLIENTS: { name: string; key: Buffer }[] = (process.env.REPORT_API_KEYS ?? "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .flatMap((pair) => {
    const at = pair.indexOf(":");
    const name = pair.slice(0, at).trim();
    const key = pair.slice(at + 1).trim();
    if (at <= 0 || key.length < 16) {
      console.warn("[clientAuth] ignoring a REPORT_API_KEYS entry: expected name:key with a key of 16+ characters");
      return [];
    }
    return [{ name, key: Buffer.from(key) }];
  });

function clientFor(given: string): string | null {
  const g = Buffer.from(given);
  for (const c of CLIENTS) {
    if (g.length === c.key.length && timingSafeEqual(g, c.key)) return c.name;
  }
  return null;
}

function bearer(header: string | undefined): string {
  const h = header ?? "";
  return h.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
}

// Sets res.locals.client when the request carries a valid key; never rejects.
export const identifyClient: RequestHandler = (req, res, next) => {
  const given = bearer(req.get("authorization"));
  res.locals.client = given ? clientFor(given) : null;
  next();
};

export const requireClient: RequestHandler = (req, res, next) => {
  const given = bearer(req.get("authorization"));
  if (!given) {
    res.status(401).json({ error: "Client key required: send Authorization: Bearer <key>" });
    return;
  }
  const name = clientFor(given);
  if (!name) {
    res.status(403).json({ error: "Unknown client key" });
    return;
  }
  res.locals.client = name;
  next();
};
