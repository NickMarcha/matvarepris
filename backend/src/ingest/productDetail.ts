// Product detail pages (meny.no/spar.no/joker.no /varer/.../slug) don't expose a
// clean JSON API for ingredients/allergens/nutrition — that data only exists
// embedded in the page's Next.js RSC payload, as an escaped JSON string inside
// `self.__next_f.push([1, "..."])` calls. We fetch the page HTML, decode those
// JS string literals, and pull the `"product": {...}` object out of the
// concatenated text with a brace-depth scanner (string-aware, so braces inside
// quoted values don't confuse it).

const USER_AGENT = "MatvarePris/1.0 (personal grocery price tracker; local use)";

export interface ProductDetail {
  ingredients: string | null;
  allergyDeclaration: string | null;
  allergens: { name: string; displayName: string; code: string }[] | null;
  nutritionalContent: { name: string; displayName: string; amount: number; unit: string }[] | null;
  countryOfOrigin: string | null;
  productionCountry: string | null;
  relevantInfo: string | null;
  packageSize: string | null;
}

const PUSH_REGEX = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/gs;

function decodeJsStringLiteral(raw: string): string {
  return JSON.parse(`"${raw}"`);
}

function findJsonObject(text: string, openBraceIndex: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++; // skip escaped char
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex, i + 1);
      }
    }
  }
  return null;
}

export async function fetchProductDetail(productPageUrl: string): Promise<ProductDetail | null> {
  const res = await fetch(productPageUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (res.status === 404) {
    // Product genuinely delisted — treat like "no product data found" so the
    // crawler marks it attempted and moves on, instead of retrying forever.
    return null;
  }
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${productPageUrl})`);
  }
  const html = await res.text();

  let decoded = "";
  for (const match of html.matchAll(PUSH_REGEX)) {
    try {
      decoded += decodeJsStringLiteral(match[1]);
    } catch {
      // some chunks aren't valid standalone string literals (partial/binary) — skip
    }
  }

  const marker = '"product":{';
  const markerIndex = decoded.indexOf(marker);
  if (markerIndex === -1) return null;

  const objStart = markerIndex + '"product":'.length;
  const jsonText = findJsonObject(decoded, objStart);
  if (!jsonText) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }

  return {
    ingredients: (raw.ingredients as string) ?? null,
    allergyDeclaration: (raw.allergyDeclaration as string) ?? null,
    allergens: (raw.allergens as ProductDetail["allergens"]) ?? null,
    nutritionalContent: (raw.nutritionalContent as ProductDetail["nutritionalContent"]) ?? null,
    countryOfOrigin: (raw.countryOfOrigin as string) ?? null,
    productionCountry: (raw.productionCountry as string) ?? null,
    relevantInfo: (raw.relevantInfo as string) ?? null,
    packageSize: (raw.packageSize as string) ?? null,
  };
}
