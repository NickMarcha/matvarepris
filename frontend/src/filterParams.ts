import type { AllergenMode, CategoryMode, Filters, SortKey, SortOrder } from "./types";

// Single source of truth for Filters <-> URLSearchParams, used both to build
// the API request and to keep the browser URL bookmarkable/shareable — the
// two are deliberately kept in the same shape so a shared URL documents the
// exact API call too.
export const DEFAULT_FILTERS: Filters = {
  chains: [],
  search: "",
  categoryFilters: {},
  minPrice: "",
  maxPrice: "",
  minUnitPrice: "",
  maxUnitPrice: "",
  onOffer: false,
  inStock: false,
  minCalories: "",
  maxCalories: "",
  minFat: "",
  maxFat: "",
  minSaturatedFat: "",
  maxSaturatedFat: "",
  minCarbs: "",
  maxCarbs: "",
  minNetCarbs: "",
  maxNetCarbs: "",
  minSugar: "",
  maxSugar: "",
  minFiber: "",
  maxFiber: "",
  minProtein: "",
  maxProtein: "",
  minSalt: "",
  maxSalt: "",
  minProteinPercent: "",
  maxProteinPercent: "",
  minCarbsPercent: "",
  maxCarbsPercent: "",
  minFatPercent: "",
  maxFatPercent: "",
  allergenFilters: {},
  dietFilters: {},
  sort: "name",
  order: "asc",
  page: 1,
  pageSize: 50,
};

const RANGE_FILTER_KEYS = [
  "Price",
  "UnitPrice",
  "Calories",
  "Fat",
  "SaturatedFat",
  "Carbs",
  "NetCarbs",
  "Sugar",
  "Fiber",
  "Protein",
  "Salt",
  "ProteinPercent",
  "CarbsPercent",
  "FatPercent",
] as const;

export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.chains.length > 0) params.set("chain", filters.chains.join(","));
  if (filters.search) params.set("search", filters.search);
  if (filters.onOffer) params.set("onOffer", "true");
  if (filters.inStock) params.set("inStock", "true");

  for (const key of RANGE_FILTER_KEYS) {
    const minVal = filters[`min${key}` as keyof Filters] as string;
    const maxVal = filters[`max${key}` as keyof Filters] as string;
    if (minVal) params.set(`min${key}`, minVal);
    if (maxVal) params.set(`max${key}`, maxVal);
  }

  const includeCategories = Object.entries(filters.categoryFilters)
    .filter(([, mode]) => mode === "include")
    .map(([name]) => name);
  const excludeCategories = Object.entries(filters.categoryFilters)
    .filter(([, mode]) => mode === "exclude")
    .map(([name]) => name);
  if (includeCategories.length > 0) params.set("includeCategories", includeCategories.join(","));
  if (excludeCategories.length > 0) params.set("excludeCategories", excludeCategories.join(","));

  const avoidAllergens = Object.entries(filters.allergenFilters)
    .filter(([, mode]) => mode === "avoid")
    .map(([name]) => name);
  const requireAllergens = Object.entries(filters.allergenFilters)
    .filter(([, mode]) => mode === "require")
    .map(([name]) => name);
  if (avoidAllergens.length > 0) params.set("avoidAllergens", avoidAllergens.join(","));
  if (requireAllergens.length > 0) params.set("requireAllergens", requireAllergens.join(","));

  const avoidDietTags = Object.entries(filters.dietFilters)
    .filter(([, mode]) => mode === "avoid")
    .map(([name]) => name);
  const requireDietTags = Object.entries(filters.dietFilters)
    .filter(([, mode]) => mode === "require")
    .map(([name]) => name);
  if (avoidDietTags.length > 0) params.set("avoidDietTags", avoidDietTags.join(","));
  if (requireDietTags.length > 0) params.set("requireDietTags", requireDietTags.join(","));

  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set("order", filters.order);
  if (filters.page !== DEFAULT_FILTERS.page) params.set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set("pageSize", String(filters.pageSize));

  return params;
}

// Used for the actual API call, where sort/order/page/pageSize must always
// be present (the backend has its own defaults, but being explicit here
// avoids relying on them staying in sync).
export function filtersToApiParams(filters: Filters): URLSearchParams {
  const params = filtersToParams(filters);
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params;
}

function parseCsvRecord<T extends string>(
  params: URLSearchParams,
  includeKey: string,
  excludeKey: string,
  includeMode: T,
  excludeMode: T,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const name of (params.get(includeKey) ?? "").split(",")) {
    if (name.trim()) result[name.trim()] = includeMode;
  }
  for (const name of (params.get(excludeKey) ?? "").split(",")) {
    if (name.trim()) result[name.trim()] = excludeMode;
  }
  return result;
}

export function paramsToFilters(params: URLSearchParams): Filters {
  const filters: Filters = { ...DEFAULT_FILTERS };

  const chain = params.get("chain");
  if (chain) filters.chains = chain.split(",").map((c) => c.trim()).filter(Boolean);

  filters.search = params.get("search") ?? "";
  filters.onOffer = params.get("onOffer") === "true";
  filters.inStock = params.get("inStock") === "true";

  for (const key of RANGE_FILTER_KEYS) {
    const minVal = params.get(`min${key}`);
    const maxVal = params.get(`max${key}`);
    if (minVal) (filters as any)[`min${key}`] = minVal;
    if (maxVal) (filters as any)[`max${key}`] = maxVal;
  }

  filters.categoryFilters = parseCsvRecord<CategoryMode>(
    params,
    "includeCategories",
    "excludeCategories",
    "include",
    "exclude",
  );
  filters.allergenFilters = parseCsvRecord<AllergenMode>(
    params,
    "requireAllergens",
    "avoidAllergens",
    "require",
    "avoid",
  );
  filters.dietFilters = parseCsvRecord<AllergenMode>(
    params,
    "requireDietTags",
    "avoidDietTags",
    "require",
    "avoid",
  );

  const sort = params.get("sort");
  if (sort) filters.sort = sort as SortKey;
  const order = params.get("order");
  if (order === "asc" || order === "desc") filters.order = order as SortOrder;
  const page = params.get("page");
  if (page) filters.page = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = params.get("pageSize");
  if (pageSize) filters.pageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));

  return filters;
}
