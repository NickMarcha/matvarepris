import type {
  CartPricingResponse,
  Category,
  Chain,
  EanHistoryResponse,
  Filters,
  GroupedProductsResponse,
  ProductDetail,
  Stats,
} from "./types";
import type { AppSettings } from "./settings";
import { filtersToApiParams } from "./filterParams";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// Hidden shops (settings, localStorage) work the same way as hidden
// categories: merged in only for the actual API call, never into the URL,
// so a shared/bookmarked link reflects what was explicitly filtered, not
// the viewer's own local preferences. `chain=` empty means "no restriction"
// to the backend, so an empty session selection has to be expanded to the
// full chain list minus hidden ones — otherwise there'd be no way to
// actually exclude a hidden chain when nothing else was selected.
function resolveEffectiveChains(sessionChains: string[], hiddenChains: string[], allChainKeys: string[]): string[] {
  if (hiddenChains.length === 0) return sessionChains;
  const base = sessionChains.length > 0 ? sessionChains : allChainKeys;
  return base.filter((c) => !hiddenChains.includes(c));
}

function buildProductParams(filters: Filters, settings: AppSettings, allChainKeys: string[]): URLSearchParams {
  const params = filtersToApiParams(filters);

  const effectiveChains = resolveEffectiveChains(filters.chains, settings.hiddenChains, allChainKeys);
  if (settings.hiddenChains.length > 0) {
    if (effectiveChains.length > 0) params.set("chain", effectiveChains.join(","));
    else params.delete("chain");
  }

  if (settings.hiddenCategories.length > 0) {
    const existing = params.get("excludeCategories");
    const merged = new Set([...(existing ? existing.split(",") : []), ...settings.hiddenCategories]);
    params.set("excludeCategories", Array.from(merged).join(","));
    const includeParam = params.get("includeCategories");
    if (includeParam) {
      const filteredInclude = includeParam.split(",").filter((c) => !settings.hiddenCategories.includes(c));
      if (filteredInclude.length > 0) params.set("includeCategories", filteredInclude.join(","));
      else params.delete("includeCategories");
    }
  }

  return params;
}

export async function fetchGroupedProducts(
  filters: Filters,
  settings: AppSettings,
  allChainKeys: string[] = [],
): Promise<GroupedProductsResponse> {
  const params = buildProductParams(filters, settings, allChainKeys);
  const res = await fetch(`${API_URL}/api/products/grouped?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
  return res.json();
}

export async function fetchCategories(
  chains: string[],
  hiddenChains: string[] = [],
  allChainKeys: string[] = [],
): Promise<Category[]> {
  const params = new URLSearchParams();
  const effectiveChains = resolveEffectiveChains(chains, hiddenChains, allChainKeys);
  if (effectiveChains.length > 0) params.set("chain", effectiveChains.join(","));
  const res = await fetch(`${API_URL}/api/categories?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);
  return res.json();
}

export async function fetchChains(): Promise<Chain[]> {
  const res = await fetch(`${API_URL}/api/chains`);
  if (!res.ok) throw new Error(`Failed to fetch chains: ${res.status}`);
  return res.json();
}

export async function fetchEanHistory(ean: string, chains?: string[]): Promise<EanHistoryResponse> {
  const params = new URLSearchParams();
  if (chains && chains.length > 0) params.set("chain", chains.join(","));
  const res = await fetch(`${API_URL}/api/products/by-ean/${encodeURIComponent(ean)}/history?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

export async function fetchCartPricing(eans: string[], chains?: string[]): Promise<CartPricingResponse> {
  if (eans.length === 0) return { items: {} };
  const params = new URLSearchParams();
  params.set("eans", eans.join(","));
  if (chains && chains.length > 0) params.set("chain", chains.join(","));
  const res = await fetch(`${API_URL}/api/products/cart-pricing?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch cart pricing: ${res.status}`);
  return res.json();
}

export async function fetchProductDetail(id: number): Promise<ProductDetail> {
  const res = await fetch(`${API_URL}/api/products/${id}/detail`);
  if (!res.ok) throw new Error(`Failed to fetch product detail: ${res.status}`);
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${API_URL}/api/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}
