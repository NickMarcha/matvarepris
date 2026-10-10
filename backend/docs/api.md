# MatvarePris API, version 1

Contract version: 1

<!-- Checked against: 408a6b6bb74c -->

Answers: how does another program get Meny, Spar and Joker products, prices and nutrition out of this, and how does it keep up when they change?

**This document is what `GET /api/v1/info` returns**, as `guide`, with the number above as `contractVersion`. A program keeps the number it was built against and re-reads this guide when the number moves. The number goes up when a change would matter to a caller: a field renamed or removed, a meaning changed, a status code changed, a new requirement. Prose fixes and new optional fields don't move it. Every bump gets a line under [Changes](#changes).

Base path: `/api/v1`. The unversioned `/api/*` routes belong to this project's own web UI and change whenever the UI needs them to. Don't build on them.

## What the data is

- Products come from NorgesGruppen's public search backend for three chains: `meny`, `spar` and `joker`. Kiwi has no webshop and isn't included. The catalog refreshes once a day, at 03:00 UTC, and again whenever the server restarts.
- Prices are chain-wide web prices, not a particular store's shelf price.
- Nutrition, allergens and ingredients aren't in the bulk catalog. A background crawler reads them from each product page at about one page every 2-3 seconds, so a new install takes about half a day to fill them in. Until then most items have `nutrition: null`.
- Diet flags come from a heuristic parser of Norwegian ingredient text. It is wrong sometimes. Don't use it for a real allergy. Allergens are the store's own legal declaration and are more trustworthy, but an allergen list can only be as complete as the crawl.

## Items

Everything is keyed by EAN (the barcode). One item is one EAN, with one offer per chain that sells it. Loose produce, bakery and deli items have a short NorgesGruppen item code instead, 4 to 7 digits (`4048` is lime). It means the same product at every chain, so treat it like an EAN. Store your references as EANs. The `productId` inside an offer is internal, differs per chain, and changes if the database is rebuilt.

```json
{
  "ean": "7038010002274",
  "title": "Biola Syrnet Melk",
  "subtitle": "Jordbær 1000g Tine",
  "brand": "Biola",
  "category": "Meieri & egg",
  "imageUrl": "https://bilder.ngdata.no/7038010002274/meny/medium.jpg",
  "content": { "amount": 1, "unit": "kg" },
  "nutrition": null,
  "allergens": null,
  "dietFlags": null,
  "offers": [
    {
      "chain": "spar", "productId": 32718,
      "price": 38.9, "comparePricePerUnit": 38.9, "compareUnit": "kg",
      "isOffer": false, "originalPrice": null, "discountPercent": null, "promotionName": null,
      "inStock": true,
      "productUrl": "https://spar.no/varer/meieri-og-egg/melk/syrnet-melk-smakstilsatt/biola-syrnet-melk-7038010002274",
      "checkedAt": "2026-10-10T12:30:17.906Z"
    }
  ]
}
```

- `offers` is sorted cheapest first. `price` is kroner for one package. `comparePricePerUnit` is kroner per `compareUnit` (`kg`, `l` or `stk`), the number the stores print as "kr/kg".
- `content` is how much one package holds, in `compareUnit`. It is computed as `price / comparePricePerUnit` from the first offer that has both, because the store's own `weight` field is shipping mass, even for drinks. It's `null` when no offer has both numbers. For loose produce sold by weight it comes out as 1 kg, which means "priced per kg", not "a 1 kg bag".
- `title`, `category` and the rest describe the chain whose nutrition was crawled most recently. Category names differ by chain ("Fisk & skalldyr", "Fisk og skalldyr", "Fisk/Skalldyr"), and this API doesn't merge them.
- `nutrition` is `null` until the product page has been crawled. After that it holds per-100 g values, and any of them can still be `null` when the page didn't list it:

  ```json
  { "energyKj": 2171, "energyKcal": 520, "fat": 31, "saturatedFat": 15.7,
    "monounsaturatedFat": null, "polyunsaturatedFat": null,
    "carbs": 49.2, "netCarbs": 46.4, "sugars": 2.5, "sugarAlcohols": null,
    "starch": null, "fiber": 2.8, "protein": 9.7, "salt": 3.5,
    "proteinPercent": 7.5, "carbsPercent": 37.8, "fatPercent": 53.7,
    "fetchedAt": "2026-10-10T12:32:25.429Z" }
  ```

  `netCarbs` is carbs minus fiber, never below 0. The three `...Percent` fields are each macro's share of energy (4 kcal/g for protein and carbs, 9 for fat). They are `null` below 5 kcal per 100 g, because bulk candy and salad bars often carry placeholder values like 1 kcal.
- `allergens` is the list of allergens the product contains, using these keys: `egg`, `fisk`, `gluten`, `melk`, `notter`, `peanotter`, `selleri`, `sennep`, `sesam`, `skalldyr`, `soya`, `sulfitt`, `blotdyr`, `lupiner`. `[]` means the store declares none. `null` means unknown.
- `dietFlags` holds what the ingredient parser found: `kjott` (meat), `gelatin`, `honning` (honey). `null` means the product page hasn't been crawled. `[]` means the parser found none of them, and that includes products whose page has no ingredient list at all, so `[]` alone doesn't prove a product is vegetarian.

## Endpoints

### `GET /api/v1/products/{ean}`

One item. Optional `chain=meny,spar` limits the offers. Returns 404 when no chain sells that EAN, and 400 when it isn't 1-14 digits.

### `POST /api/v1/products/lookup`

Many items in one call, for a shopping list or a pantry.

```json
{ "eans": ["7038010002274", "7350137710017"], "chains": ["meny"] }
```

```json
{ "items": [ ... ], "missing": ["7350137710017"] }
```

At most 200 EANs per call. Duplicates are ignored. `items` keeps the order you sent. An EAN lands in `missing` when none of the requested chains sell it. Bad input returns 400 with the offending values in `invalid`.

### `GET /api/v1/products`

Search. Returns `{ total, page, pageSize, items }` with the same item shape as above.

| Parameter | Meaning |
|---|---|
| `search` | Substring of title, subtitle or brand |
| `chain` | `meny,spar,joker`, any subset. Also limits each item's offers |
| `includeCategories`, `excludeCategories` | Comma-separated raw category names from `/categories` |
| `minPrice`, `maxPrice`, `minUnitPrice`, `maxUnitPrice` | Kroner. True when at least one offer is in range |
| `onOffer=true`, `inStock=true` | At least one offer is on sale or in stock |
| `min…`/`max…` + `Calories`, `Fat`, `SaturatedFat`, `Carbs`, `NetCarbs`, `Sugar`, `Fiber`, `Protein`, `Salt` | Per 100 g, e.g. `minProtein=20` |
| `min…`/`max…` + `ProteinPercent`, `CarbsPercent`, `FatPercent` | Share of energy, e.g. `minProteinPercent=40` |
| `avoidAllergens`, `requireAllergens` | Allergen keys, comma-separated |
| `avoidDietTags`, `requireDietTags` | `kjott`, `gelatin`, `honning` |
| `sort` | `name` (default), `price`, `unitPrice`, `category`, `discountPercent`, `discountAmount`, `calories`, `fat`, `saturatedFat`, `carbs`, `netCarbs`, `sugar`, `fiber`, `protein`, `salt`, `proteinPercent`, `carbsPercent`, `fatPercent` |
| `order` | `asc` (default) or `desc`. Missing values always sort last |
| `page`, `pageSize` | `pageSize` defaults to 50, at most 200 |

`price` and `unitPrice` sort by the cheapest offer. "Avoid" and "require" don't treat unknown the same way. A product that hasn't been crawled yet still shows up under `avoidAllergens=melk`, because nobody knows yet that it has milk. It does not show up under `requireAllergens=melk`, because nobody can confirm it does. Until the crawl is done, "avoid" isn't a safety filter.

To find the cheapest chicken fillet per kg: `GET /api/v1/products?search=kyllingfilet&inStock=true&sort=unitPrice`.

### `GET /api/v1/products/{ean}/history`

Price history per chain: `{ ean, chains: [{ chain, productId, title, subtitle, compareUnit, points: [...] }] }`. A point is written only when price, unit price, discount, offer or stock actually changed, not on every refresh. Each point has `changedAt`, `price`, `comparePricePerUnit`, `originalPrice`, `discountAmount`, `isOffer`, `isOutOfStock`, `isForSale`, `promotionName`. Optional `chain=` filter.

### `GET /api/v1/chains`

`[{ key, displayName, productCount, lastCheckedAt }]`. `lastCheckedAt` is the last time the catalog refresh saw any product from that chain.

### `GET /api/v1/categories`

`[{ name, chain, count }]`, one row per raw category name per chain. Optional `chain=`.

### `GET /api/v1/changes`

Which items changed since you last asked. Poll it instead of re-reading everything you track.

```
GET /api/v1/changes?since=781.22204&limit=500
```

```json
{
  "cursor": "781.22206",
  "hasMore": false,
  "changes": [
    { "ean": "7038010000072", "chain": "meny", "kinds": ["price"] },
    { "ean": "7048840000500", "chain": "spar", "kinds": ["offer", "availability"] }
  ]
}
```

- Leave `since` out to start from the beginning, which lists every product once as `new`. Send `since=latest` to skip the history: you get no changes, just a cursor for the current position.
- Store `cursor` and send it back next time. Treat it as an opaque string. A cursor is for this database only, so start over if the server's data is ever rebuilt.
- `limit` defaults to 500, at most 2000. When `hasMore` is true, call again with the new cursor straight away.
- `kinds` says what changed: `new`, `price`, `offer`, `availability`, `nutrition` (includes allergens and diet flags), `info` (title, brand, category, image). It only describes the product's most recent change, so always re-read the item with `/products/lookup` rather than patching your copy field by field.
- Each chain's copy of a product sits at the position of its latest change only. If it changes again before you read it, it moves forward, so you see it once. The same EAN can still appear once per chain.
- Changes appear a little late on purpose. A change shows up only after every database write that started before it has finished, so a cursor never skips anything.

A sync loop:

1. Get a cursor once with `since=latest` and store it. Load what you need with `/products/lookup`.
2. Every few minutes, or once after the daily refresh, call `/changes?since=<cursor>`. Keep going while `hasMore` is true.
3. Collect the EANs you care about from `changes`, re-read them with `/products/lookup`, and store the last cursor.

### `GET /api/v1/info` and `GET /api/v1/health`

`info` returns `{ contractVersion, guide }`, where `guide` is this document. `health` returns `{ ok: true }` when the process is up.

### `GET /api/v1/openapi.json`

An OpenAPI 3.1 description of every v1 endpoint, with an `operationId` on each (`lookupProducts`, `listChanges`, ...) for client generators. For TypeScript, `npx openapi-typescript https://matvarepris.nickmarcha.com/api/v1/openapi.json -o matvarepris.d.ts` gives you types for all of it. `info.version` in the spec is the contract version. The spec covers field names and types. What a `null` means, and how to run the change-feed loop, is only in this guide.

Response objects are open. A new optional field can appear without a version bump, so don't reject properties you don't recognise.

## Errors and limits

Errors are JSON, `{ "error": "..." }`, with a 4xx or 5xx status. The public deployment (`matvarepris.nickmarcha.com`) rate-limits by IP and answers 429 when you go over: about 10 requests a second with bursts to 40. There are no API keys for reading. On the same Docker network as the server, there are no limits.

## Admin endpoints

These are outside v1 and listed only so the 401 makes sense. `POST /api/ingest/run` starts a catalog refresh. `POST /api/diet-classification/reclassify` re-runs the diet parser. Both need `Authorization: Bearer <ADMIN_API_KEY>` when the server has that variable set. The public deployment refuses them from the internet whatever the key.

## Changes

- **1** (2026-10-10). First version.
