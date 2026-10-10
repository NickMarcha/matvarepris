import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

// Guards the endpoints that make the server do work on its own initiative
// (catalog ingest, diet reclassify). Callers send `Authorization: Bearer <key>`.
// Left unset, the guard lets everything through so `docker compose up` on a
// laptop keeps working with no setup; any deployment someone else can reach
// must set it.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";

export function warnIfAdminOpen(): void {
  if (!ADMIN_API_KEY) {
    console.warn("[auth] ADMIN_API_KEY is not set: admin endpoints are open to anyone who can reach the API");
  }
}

function matches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!ADMIN_API_KEY) return next();
  const header = req.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!given) {
    res.status(401).json({ error: "Admin key required: send Authorization: Bearer <key>" });
    return;
  }
  if (!matches(given)) {
    res.status(403).json({ error: "Wrong admin key" });
    return;
  }
  next();
};
