import type { NgdataProductHit, NgdataSearchResponse, NormalizedProduct } from "../types.js";

const BASE_URL = "https://platform-rest-prod.ngdata.no/api/episearch";
const USER_AGENT = "MatvarePris/1.0 (personal grocery price tracker; local use)";

export interface FetchPageResult {
  total: number;
  products: NormalizedProduct[];
}

export interface CategoryBucket {
  name: string;
  count: number;
}

// Elasticsearch's default result window caps `from + size` at 10000, so a
// chain's full catalog (>10k for Meny) can't be paged through in one flat
// sweep. Categories fully partition the catalog (verified: bucket counts sum
// exactly to the unfiltered total, no remainder) and every category is well
// under the 10k window, so we page per-category instead.
export async function fetchCategories(chainId: number): Promise<CategoryBucket[]> {
  const url = new URL(`${BASE_URL}/${chainId}/products`);
  url.searchParams.set("search", "");
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "1");
  url.searchParams.set("types", "products");
  url.searchParams.set("popularity", "true");
  url.searchParams.set("showNotForSale", "true");
  url.searchParams.set("full_response", "true");

  const res = await fetchWithRetry(url.toString());
  const data = (await res.json()) as { aggregations?: { Categories?: { buckets: { key: string; doc_count: number }[] } } };
  const buckets = data.aggregations?.Categories?.buckets ?? [];
  return buckets.map((b) => ({ name: b.key, count: b.doc_count }));
}

export async function fetchProductPage(
  chainId: number,
  page: number,
  pageSize: number,
  category?: string,
): Promise<FetchPageResult> {
  const url = new URL(`${BASE_URL}/${chainId}/products`);
  url.searchParams.set("search", "");
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("types", "products");
  url.searchParams.set("popularity", "true");
  url.searchParams.set("showNotForSale", "true");
  if (category) {
    url.searchParams.set("facet", `Categories:${category}`);
  }

  const res = await fetchWithRetry(url.toString());
  const data = (await res.json()) as NgdataSearchResponse;

  return {
    total: data.total,
    products: data.hits.map(normalizeProduct).filter((p): p is NormalizedProduct => p !== null),
  };
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(500 * (i + 1));
      }
    }
  }
  throw lastErr;
}

function normalizeProduct(hit: NgdataProductHit): NormalizedProduct | null {
  const d = hit.contentData;
  const ean = d.ean ?? hit.contentId;
  if (!ean) return null;

  // Some promotions ("3 for 2" mix-and-match) leave the sticker price
  // unchanged (pricePerUnitOriginal === pricePerUnit, offerDiscountPerUnit
  // 0) — only treat it as a real price cut when there's an actual reduction,
  // so "sort by discount" isn't polluted with zero-value entries.
  const discountAmount = d.offerDiscountPerUnit ?? null;
  const hasRealDiscount = discountAmount !== null && discountAmount > 0;

  return {
    ean,
    title: d.title ?? "Unknown",
    subtitle: d.subtitle ?? null,
    categoryName: d.categoryName ?? null,
    brand: d.brand ?? null,
    vendor: d.vendor ?? null,
    unit: d.unit ?? null,
    unitType: d.unitType ?? null,
    compareUnit: d.compareUnit ?? null,
    weight: d.weight ?? null,
    imagePath: d.imagePath ?? null,
    slugifiedUrl: d.slugifiedUrl ?? null,
    isLocal: Boolean(d.isLocal),
    containsAlcohol: Boolean(d.containsAlcohol),
    price: d.pricePerUnit ?? null,
    pricePerUnit: d.pricePerUnit ?? null,
    comparePricePerUnit: d.comparePricePerUnit ?? null,
    originalPrice: hasRealDiscount ? d.pricePerUnitOriginal ?? null : null,
    discountAmount: hasRealDiscount ? discountAmount : null,
    isOffer: Boolean(d.isOffer),
    isOutOfStock: Boolean(d.isOutOfStock),
    isForSale: d.isForSale !== false,
    promotionName: d.promotionDisplayName || null,
    promotionId: d.promotionId ?? null,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
