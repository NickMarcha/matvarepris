import { sleep } from "./ngdataClient.js";

// Kassalapp (kassal.app): price data from many Norwegian grocery chains.
// Only POST /products/prices-bulk is used: up to 100 EANs per call, current
// price per store plus a daily price history. The key is a personal bearer
// token (KASSALAPP_API_KEY) and the limit is 60 calls a minute, so calls are
// spaced a little over a second apart and a 429 waits and retries.

const BASE = "https://kassal.app/api/v1";
export const BULK_MAX_EANS = 100;
const MIN_GAP_MS = 1100;
const MAX_RETRIES = 3;

export interface KassalappStorePrice {
  store: string; // e.g. "ODA_NO", "BUNNPRIS", "KIWI"
  name: string;
  current_price: string | number | null; // arrives as a string ("35.20")
  current_unit_price: number | null; // unreliable: per ml on Oda, null on Bunnpris
  current_unit_price_unit: string | null;
  last_checked: string | null;
}

export interface KassalappHistoryPoint {
  price: number;
  date: string; // YYYY-MM-DD, one point per store per day (min of the day)
  store: string;
}

export interface KassalappBulkItem {
  ean: string;
  name: string;
  weight: number | null;
  weight_unit: string | null;
  stores: KassalappStorePrice[];
  price_history: KassalappHistoryPoint[];
}

let nextSlot = 0;
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
}

export interface KassalappProduct {
  name: string | null;
  brand: string | null;
  vendor: string | null;
  image: string | null;
  weight: number | null;
  weight_unit: string | null;
}
export interface KassalappNutrient {
  code: string;
  amount: number;
}
export interface KassalappComparison {
  ean: string | null;
  products: KassalappProduct[];
  nutrition: KassalappNutrient[] | null;
}

export class KassalappUnavailable extends Error {}

// GET /products/ean/{ean}: every store's listing of one barcode, for
// identifying it (name, size, picture, nutrition). null = Kassalapp doesn't
// know it. Shares the bulk calls' rate budget.
export async function fetchProductByEan(apiKey: string, ean: string): Promise<KassalappComparison | null> {
  await waitForSlot();
  let res: Response;
  try {
    res = await fetch(`${BASE}/products/ean/${ean}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new KassalappUnavailable(`Kassalapp unreachable: ${String(err)}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new KassalappUnavailable(`Kassalapp answered ${res.status}`);
  const body = (await res.json()) as { data?: KassalappComparison };
  return body.data ?? null;
}

export async function fetchBulkPrices(apiKey: string, eans: string[], days: number): Promise<KassalappBulkItem[]> {
  for (let attempt = 0; ; attempt++) {
    await waitForSlot();
    const res = await fetch(`${BASE}/products/prices-bulk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ eans, days, aggregation: "min" }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after")) || 60;
      console.warn(`[kassalapp] 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`prices-bulk returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { data?: KassalappBulkItem[] };
    return body.data ?? [];
  }
}
