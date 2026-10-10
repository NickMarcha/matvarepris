import { z } from "zod";
import { GROUPED_SORT_COLUMNS, RANGE_FILTER_COLUMNS } from "./products.js";
import { CHANGE_KINDS, EAN_DESCRIPTION, EAN_PATTERN, LOOKUP_MAX_EANS, registry } from "./v1Schemas.js";

// Builds /api/v1/openapi.json from the zod schemas in v1Schemas.ts. The
// paths are written out here by hand; the search parameters come from the
// same tables products.ts filters and sorts with, so they can't drift apart.

type Json = Record<string, unknown>;

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

const json = (schema: Json, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});

const errorResponse = (description: string) => json(ref("Error"), description);

const query = (name: string, schema: Json, description?: string) => ({
  name,
  in: "query",
  required: false,
  schema,
  ...(description ? { description } : {}),
});

const eanPath = {
  name: "ean",
  in: "path",
  required: true,
  description: EAN_DESCRIPTION,
  schema: { type: "string", pattern: EAN_PATTERN.source },
};

const chainFilter = query("chain", { type: "string" }, "Comma-separated chain keys (meny, spar, joker); limits the offers");

// min/max pairs the grouped query handles explicitly, next to the plain
// per-100 g columns in RANGE_FILTER_COLUMNS.
const COMPUTED_RANGE_FILTERS = ["NetCarbs", "ProteinPercent", "CarbsPercent", "FatPercent"];

function searchParameters() {
  const ranges = [...Object.keys(RANGE_FILTER_COLUMNS), ...COMPUTED_RANGE_FILTERS].flatMap((key) => [
    query(`min${key}`, { type: "number" }),
    query(`max${key}`, { type: "number" }),
  ]);
  const csv = { type: "string" };
  return [
    query("search", { type: "string" }, "Substring of title, subtitle or brand"),
    chainFilter,
    query("includeCategories", csv, "Comma-separated raw category names"),
    query("excludeCategories", csv, "Comma-separated raw category names"),
    query("minPrice", { type: "number" }),
    query("maxPrice", { type: "number" }),
    query("minUnitPrice", { type: "number" }),
    query("maxUnitPrice", { type: "number" }),
    query("onOffer", { type: "string", enum: ["true"] }),
    query("inStock", { type: "string", enum: ["true"] }),
    ...ranges,
    query("avoidAllergens", csv, "Unknown (not crawled) products are kept"),
    query("requireAllergens", csv, "Unknown (not crawled) products are dropped"),
    query("avoidDietTags", csv, "kjott, gelatin, honning"),
    query("requireDietTags", csv, "kjott, gelatin, honning"),
    query("sort", { type: "string", enum: Object.keys(GROUPED_SORT_COLUMNS), default: "name" }),
    query("order", { type: "string", enum: ["asc", "desc"], default: "asc" }),
    query("page", { type: "integer", minimum: 1, default: 1 }),
    query("pageSize", { type: "integer", minimum: 1, maximum: 200, default: 50 }),
  ];
}

// Output schemas are open: new optional fields don't bump the contract
// version, so clients have to accept properties they don't know about.
// Per-schema $schema/$id are dropped because components live inside the
// OpenAPI document, not as standalone JSON Schema documents.
function componentSchemas(): Record<string, Json> {
  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}` }) as {
    schemas: Record<string, Json>;
  };
  const open = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(open);
    if (node && typeof node === "object") {
      const obj = node as Json;
      if (obj.additionalProperties === false) delete obj.additionalProperties;
      Object.values(obj).forEach(open);
    }
  };
  for (const [id, schema] of Object.entries(schemas)) {
    delete schema.$schema;
    delete schema.$id;
    if (id !== "LookupRequest") open(schema);
  }
  return schemas;
}

// The public deployment rate-limits every route by IP (nginx), so every
// operation can answer 429.
function withRateLimit<T extends Record<string, Record<string, { responses: Record<string, unknown> }>>>(paths: T): T {
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      operation.responses[429] = errorResponse("Rate limited (public deployment only)");
    }
  }
  return paths;
}

export function buildOpenApi(contractVersion: number) {
  return {
    openapi: "3.1.0",
    info: {
      title: "MatvarePris API",
      version: String(contractVersion),
      description:
        "Meny, Spar and Joker products, prices and nutrition, keyed by EAN. " +
        "The full guide, with the meaning of nulls and the change-feed loop, is at /api/v1/info.",
    },
    servers: [{ url: "/api/v1" }],
    // Reading needs no key.
    security: [],
    paths: withRateLimit({
      "/products": {
        get: {
          operationId: "searchProducts", summary: "Search items",
          parameters: searchParameters(),
          responses: { 200: json(ref("ItemPage")) },
        },
      },
      "/products/lookup": {
        post: {
          operationId: "lookupProducts", summary: `Many items by EAN, up to ${LOOKUP_MAX_EANS}`,
          requestBody: { required: true, content: { "application/json": { schema: ref("LookupRequest") } } },
          responses: { 200: json(ref("LookupResponse")), 400: errorResponse("Bad body") },
        },
      },
      "/products/{ean}": {
        get: {
          operationId: "getProduct", summary: "One item",
          parameters: [eanPath, chainFilter],
          responses: {
            200: json(ref("Item")),
            400: errorResponse("Not 1-14 digits"),
            404: errorResponse("No chain sells this EAN"),
          },
        },
      },
      "/products/{ean}/history": {
        get: {
          operationId: "getProductHistory", summary: "Price history per chain",
          parameters: [eanPath, chainFilter],
          responses: { 200: json(ref("History")), 404: errorResponse("No chain sells this EAN") },
        },
      },
      "/chains": {
        get: { operationId: "listChains", summary: "Chains with product counts", responses: { 200: json({ type: "array", items: ref("Chain") }) } },
      },
      "/categories": {
        get: {
          operationId: "listCategories", summary: "Raw category names per chain",
          parameters: [chainFilter],
          responses: { 200: json({ type: "array", items: ref("Category") }) },
        },
      },
      "/changes": {
        get: {
          operationId: "listChanges", summary: "Items changed since a cursor",
          description: `kinds: ${CHANGE_KINDS.join(", ")}. See the guide for the sync loop.`,
          parameters: [
            query("since", { type: "string" }, "Cursor from a previous response, or \"latest\". Omit to start from the beginning"),
            query("limit", { type: "integer", minimum: 1, maximum: 2000, default: 500 }),
          ],
          responses: { 200: json(ref("ChangePage")), 400: errorResponse("Bad cursor") },
        },
      },
      "/info": { get: { operationId: "getInfo", summary: "Contract version and the API guide", responses: { 200: json(ref("Info")) } } },
      "/health": { get: { operationId: "getHealth", summary: "Process is up", responses: { 200: json(ref("Health")) } } },
      "/openapi.json": { get: { operationId: "getOpenApi", summary: "This document", responses: { 200: { description: "OpenAPI 3.1" } } } },
    }),
    components: { schemas: componentSchemas() },
  };
}
