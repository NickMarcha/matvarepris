import { z } from "zod";

// Shapes of every /api/v1 response, in one place. v1.ts annotates its
// mappers with these types, so a field added or dropped on one side and not
// the other fails the TypeScript build. v1OpenApi.ts turns the same schemas
// into /api/v1/openapi.json, and `npm run check-api` parses live responses
// with them to catch type mistakes TypeScript can't see (pg returns numeric
// columns as strings, for one).
//
// Each schema registered here becomes components/schemas/<id> in the spec.

export const registry = z.registry<{ id: string; description?: string }>();

function register<T extends z.ZodType>(schema: T, id: string, description?: string): T {
  registry.add(schema, { id, description });
  return schema;
}

export const EAN_DESCRIPTION = "EAN, or a 4-7 digit item code for loose produce";

const timestamp = z.string().describe("ISO 8601 timestamp");

// Packaged goods have 8-14 digit EANs. Loose produce, bakery and deli items
// use NorgesGruppen's short item codes (4-7 digits, e.g. 4048 is lime), which
// mean the same product at every chain, so they work as keys too.
export const EAN_PATTERN = /^\d{1,14}$/;
export const LOOKUP_MAX_EANS = 200;
export const CHANGE_KINDS = ["new", "price", "offer", "availability", "nutrition", "info"] as const;

export const Content = register(
  z.object({
    amount: z.number().describe("How much one package holds, in `unit`"),
    unit: z.string().describe("Same as the offers' compareUnit: kg, l or stk"),
  }),
  "Content",
  "Package content, computed as price / comparePricePerUnit. For loose produce sold by weight this is 1 kg, meaning priced per kg.",
);

export const Nutrition = register(
  z.object({
    energyKj: z.number().nullable(),
    energyKcal: z.number().nullable(),
    fat: z.number().nullable(),
    saturatedFat: z.number().nullable(),
    monounsaturatedFat: z.number().nullable(),
    polyunsaturatedFat: z.number().nullable(),
    carbs: z.number().nullable(),
    netCarbs: z.number().nullable().describe("carbs minus fiber, never below 0"),
    sugars: z.number().nullable(),
    sugarAlcohols: z.number().nullable(),
    starch: z.number().nullable(),
    fiber: z.number().nullable(),
    protein: z.number().nullable(),
    salt: z.number().nullable(),
    proteinPercent: z.number().nullable().describe("Share of energy; null below 5 kcal per 100 g"),
    carbsPercent: z.number().nullable().describe("Share of energy; null below 5 kcal per 100 g"),
    fatPercent: z.number().nullable().describe("Share of energy; null below 5 kcal per 100 g"),
    fetchedAt: timestamp.nullable(),
  }),
  "Nutrition",
  "Per 100 g. Any value can be null when the product page didn't list it.",
);

export const Offer = register(
  z.object({
    chain: z.string().describe("meny, spar or joker"),
    productId: z.number().int().describe("Internal, per chain. Store EANs, not this"),
    price: z.number().nullable().describe("Kroner for one package"),
    comparePricePerUnit: z.number().nullable().describe("Kroner per compareUnit"),
    compareUnit: z.string().nullable(),
    isOffer: z.boolean(),
    originalPrice: z.number().nullable(),
    discountPercent: z.number().nullable(),
    promotionName: z.string().nullable(),
    inStock: z.boolean(),
    productUrl: z.string().nullable(),
    checkedAt: timestamp,
  }),
  "Offer",
  "One chain's listing of an EAN.",
);

export const Item = register(
  z.object({
    ean: z.string().describe(EAN_DESCRIPTION),
    title: z.string(),
    subtitle: z.string().nullable(),
    brand: z.string().nullable(),
    category: z.string().nullable().describe("Raw per-chain category name"),
    imageUrl: z.string().nullable(),
    content: Content.nullable(),
    nutrition: Nutrition.nullable().describe("null until the product page has been crawled"),
    allergens: z
      .array(z.string())
      .nullable()
      .describe("Allergen keys the product contains. [] = declares none, null = unknown"),
    dietFlags: z
      .array(z.string())
      .nullable()
      .describe("kjott, gelatin, honning. null = not crawled; [] also covers products with no ingredient list"),
    offers: z.array(Offer).describe("Cheapest first"),
  }),
  "Item",
  "One EAN with one offer per chain that sells it.",
);

export const ItemPage = register(
  z.object({
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    items: z.array(Item),
  }),
  "ItemPage",
);

export const LookupRequest = register(
  z.object({
    eans: z.array(z.string().regex(EAN_PATTERN)).min(1).max(LOOKUP_MAX_EANS),
    chains: z.array(z.string()).optional().describe("Limit offers to these chains"),
  }),
  "LookupRequest",
);

export const LookupResponse = register(
  z.object({
    items: z.array(Item).describe("In the order requested, duplicates removed"),
    missing: z.array(z.string()).describe("EANs none of the requested chains sell"),
  }),
  "LookupResponse",
);

export const HistoryPoint = register(
  z.object({
    changedAt: timestamp,
    price: z.number().nullable(),
    comparePricePerUnit: z.number().nullable(),
    originalPrice: z.number().nullable(),
    discountAmount: z.number().nullable(),
    isOffer: z.boolean().nullable(),
    isOutOfStock: z.boolean().nullable(),
    isForSale: z.boolean().nullable(),
    promotionName: z.string().nullable(),
  }),
  "HistoryPoint",
  "Written only when price, unit price, discount, offer or stock changed.",
);

export const History = register(
  z.object({
    ean: z.string(),
    chains: z.array(
      z.object({
        chain: z.string(),
        productId: z.number().int(),
        title: z.string(),
        subtitle: z.string().nullable(),
        compareUnit: z.string().nullable(),
        points: z.array(HistoryPoint),
      }),
    ),
  }),
  "History",
);

export const Chain = register(
  z.object({
    key: z.string(),
    displayName: z.string(),
    productCount: z.number().int(),
    lastCheckedAt: timestamp.nullable(),
  }),
  "Chain",
);

export const Category = register(
  z.object({ name: z.string(), chain: z.string(), count: z.number().int() }),
  "Category",
);

export const Change = register(
  z.object({
    ean: z.string(),
    chain: z.string(),
    kinds: z.array(z.enum(CHANGE_KINDS)).describe("What changed in this product's latest change only"),
  }),
  "Change",
);

export const ChangePage = register(
  z.object({
    cursor: z.string().describe("Opaque. Send back as `since`"),
    hasMore: z.boolean(),
    changes: z.array(Change),
  }),
  "ChangePage",
);

export const Info = register(
  z.object({
    contractVersion: z.number().int(),
    guide: z.string().describe("The API guide as Markdown"),
  }),
  "Info",
);

export const Health = register(z.object({ ok: z.literal(true) }), "Health");

export const ApiError = register(
  z.object({
    error: z.string(),
    invalid: z.array(z.unknown()).optional().describe("Lookup only: the values that failed validation"),
  }),
  "Error",
);

export type ItemT = z.infer<typeof Item>;
export type OfferT = z.infer<typeof Offer>;
export type ContentT = z.infer<typeof Content>;
export type ChangePageT = z.infer<typeof ChangePage>;
