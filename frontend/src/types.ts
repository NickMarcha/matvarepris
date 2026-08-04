export interface Nutrition {
  energyKj: number | null;
  energyKcal: number | null;
  fat: number | null;
  saturatedFat: number | null;
  monounsaturatedFat: number | null;
  polyunsaturatedFat: number | null;
  carbs: number | null;
  netCarbs: number | null;
  sugars: number | null;
  sugarAlcohols: number | null;
  starch: number | null;
  fiber: number | null;
  protein: number | null;
  salt: number | null;
  proteinPercent: number | null;
  carbsPercent: number | null;
  fatPercent: number | null;
  fetchedAt: string | null;
}

export interface Product {
  id: number;
  chain: string;
  ean: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  brand: string | null;
  vendor: string | null;
  unit: string | null;
  unitType: string | null;
  compareUnit: string | null;
  weight: number | null;
  price: number | null;
  pricePerUnit: number | null;
  comparePricePerUnit: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  discountPercent: number | null;
  isOffer: boolean;
  isOutOfStock: boolean;
  isForSale: boolean;
  promotionName: string | null;
  isLocal: boolean;
  containsAlcohol: boolean;
  imageUrl: string | null;
  productUrl: string | null;
  lastSeenAt: string;
  nutrition: Nutrition;
  containsAllergens: string[];
  dietFlags: string[];
  dietParseStatus: "ok" | "no_ingredients" | null;
  dietUnmatchedTokens: string[];
}

export interface ProductsResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Product[];
}

// One entry per EAN (barcode) instead of one per (chain, ean) row — same
// physical product shown once with a per-store price/stock breakdown.
export interface ProductGroup {
  ean: string;
  memberCount: number;
  cheapestPrice: number | null;
  cheapestUnitPrice: number | null;
  bestDiscountAmount: number | null;
  bestDiscountPercent: number | null;
  anyOnOffer: boolean;
  anyInStock: boolean;
  hasDataMismatch: boolean; // crawled stores disagree on nutrition/allergens
  mismatchNote: string | null; // human-readable summary for a tooltip
  representative: Product; // only .nutrition/.containsAllergens/.dietFlags/.dietParseStatus consumed
  members: Product[]; // cheapest-first
}

export interface GroupedProductsResponse {
  total: number; // number of groups, not raw rows
  page: number;
  pageSize: number;
  items: ProductGroup[];
}

export interface Category {
  name: string;
  chain: string;
  count: number;
}

export interface Chain {
  key: string;
  displayName: string;
  productCount: number;
  lastCheckedAt: string | null;
}

export interface IngestChainSummary {
  chain: string;
  totalSeen: number;
  inserted: number;
  changed: number;
  unchanged: number;
  errors: number;
  durationMs: number;
}

export interface Stats {
  chains: Chain[];
  catalog: {
    totalProducts: number;
    onOfferCount: number;
    avgDiscountPercent: number | null;
    categoryCount: number;
    priceHistoryCount: number;
  };
  nutritionCrawl: {
    totalProducts: number;
    remaining: number;
    crawled: number;
  };
  ingest: {
    running: boolean;
    lastRun: { startedAt: string; finishedAt: string; summaries: IngestChainSummary[] } | null;
  };
}

export interface PriceHistoryPoint {
  changedAt: string;
  price: number | null;
  comparePricePerUnit: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  isOffer: boolean;
  isOutOfStock: boolean;
  isForSale: boolean;
  promotionName: string | null;
}

export interface ProductHistoryResponse {
  product: Product;
  history: PriceHistoryPoint[];
}

export interface ChainHistorySeries {
  chain: string;
  productId: number;
  title: string;
  subtitle: string | null;
  compareUnit: string | null;
  points: PriceHistoryPoint[];
}

export interface EanHistoryResponse {
  ean: string;
  chains: ChainHistorySeries[];
}

export interface Allergen {
  name: string;
  displayName: string;
  code: string; // "JA" = contains, "FRI" = free of
}

export interface NutritionEntry {
  name: string;
  displayName: string;
  amount: number;
  unit: string;
}

export interface ProductDetail {
  ingredients: string | null;
  allergyDeclaration: string | null;
  allergens: Allergen[] | null;
  nutritionalContent: NutritionEntry[] | null;
  countryOfOrigin: string | null;
  productionCountry: string | null;
  relevantInfo: string | null;
  packageSize: string | null;
  fetchedAt: string;
  dietFlags: string[];
  dietParseStatus: "ok" | "no_ingredients" | null;
}

export type SortKey =
  | "name"
  | "price"
  | "unitPrice"
  | "category"
  | "discountPercent"
  | "discountAmount"
  | "calories"
  | "fat"
  | "saturatedFat"
  | "carbs"
  | "netCarbs"
  | "sugar"
  | "fiber"
  | "protein"
  | "salt"
  | "proteinPercent"
  | "carbsPercent"
  | "fatPercent";
export type SortOrder = "asc" | "desc";

export type AllergenMode = "avoid" | "require";
export type CategoryMode = "include" | "exclude";

export interface Filters {
  chains: string[];
  search: string;
  categoryFilters: Record<string, CategoryMode>;
  minPrice: string;
  maxPrice: string;
  minUnitPrice: string;
  maxUnitPrice: string;
  onOffer: boolean;
  inStock: boolean;
  minCalories: string;
  maxCalories: string;
  minFat: string;
  maxFat: string;
  minSaturatedFat: string;
  maxSaturatedFat: string;
  minCarbs: string;
  maxCarbs: string;
  minNetCarbs: string;
  maxNetCarbs: string;
  minSugar: string;
  maxSugar: string;
  minFiber: string;
  maxFiber: string;
  minProtein: string;
  maxProtein: string;
  minSalt: string;
  maxSalt: string;
  minProteinPercent: string;
  maxProteinPercent: string;
  minCarbsPercent: string;
  maxCarbsPercent: string;
  minFatPercent: string;
  maxFatPercent: string;
  allergenFilters: Record<string, AllergenMode>;
  dietFilters: Record<string, AllergenMode>;
  sort: SortKey;
  order: SortOrder;
  page: number;
  pageSize: number;
}

// Keyed by EAN, not by a specific store's row — a cart entry represents the
// physical product, not any one store's listing of it. Live pricing per
// store is fetched separately (see CartPricingResponse) so totals always
// reflect the latest data instead of a stale snapshot from add-time.
export interface CartItem {
  ean: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  quantity: number;
}

export interface CartPricingEntry {
  chain: string;
  price: number | null;
  compareUnitPrice: number | null;
  compareUnit: string | null;
  isOutOfStock: boolean;
  isForSale: boolean;
  productUrl: string | null;
}

export interface CartPricingResponse {
  items: Record<string, CartPricingEntry[]>;
}
