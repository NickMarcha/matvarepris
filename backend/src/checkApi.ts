// Calls every /api/v1 endpoint on a running server and parses each response
// with its schema from routes/v1Schemas.ts. TypeScript already checks field
// names; this catches the runtime types it can't see, like a pg numeric
// column leaking through as a string. Read-only, safe against production.
//
//   npm run check-api                               # http://localhost:4000
//   npm run check-api -- https://matvarepris.nickmarcha.com
import { z } from "zod";
import {
  ApiError,
  Category,
  ChangePage,
  Chain,
  Health,
  History,
  Info,
  Item,
  ItemPage,
  LookupResponse,
} from "./routes/v1Schemas.js";

const base = `${(process.argv[2] ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1`;
let failures = 0;

async function check(label: string, schema: z.ZodType, path: string, init?: RequestInit, status = 200): Promise<any> {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (res.status !== status || !parsed.success) {
    failures++;
    console.log(`FAIL ${label}: HTTP ${res.status} (wanted ${status})`);
    if (!parsed.success) console.log(z.prettifyError(parsed.error));
    return body;
  }
  console.log(`ok   ${label}`);
  return parsed.data;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

await check("health", Health, "/health");
await check("info", Info, "/info");
await check("chains", z.array(Chain), "/chains");
await check("categories", z.array(Category), "/categories?chain=meny");

const search = await check("search", ItemPage, "/products?search=melk&pageSize=20");
const crawled = await check("search, crawled only", ItemPage, "/products?minCalories=0&sort=protein&order=desc&pageSize=20");
const onOffer = await check("search, on offer", ItemPage, "/products?onOffer=true&sort=discountPercent&order=desc&pageSize=20");

const eans: string[] = [...(search.items ?? []), ...(crawled.items ?? []), ...(onOffer.items ?? [])]
  .map((i: { ean: string }) => i.ean)
  .slice(0, 50);

if (eans.length > 0) {
  await check("item", Item, `/products/${eans[0]}`);
  await check("history", History, `/products/${eans[0]}/history`);
  await check("lookup", LookupResponse, "/products/lookup", post({ eans: [...eans, "00000000"] }));
}
await check("item, unknown EAN", ApiError, "/products/00000000", undefined, 404);
await check("item, bad EAN", ApiError, "/products/abc", undefined, 400);
await check("lookup, bad body", ApiError, "/products/lookup", post({ eans: ["abc"] }), 400);

const first = await check("changes from start", ChangePage, "/changes?limit=50");
if (first.cursor) await check("changes from cursor", ChangePage, `/changes?since=${first.cursor}&limit=50`);
await check("changes latest", ChangePage, "/changes?since=latest");
await check("changes, bad cursor", ApiError, "/changes?since=nope", undefined, 400);

const spec = await fetch(`${base}/openapi.json`);
if (spec.ok) console.log("ok   openapi.json");
else {
  failures++;
  console.log(`FAIL openapi.json: HTTP ${spec.status}`);
}

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
