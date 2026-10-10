# MatvarePris

A personal tool for exploring NorgesGruppen grocery data (Meny, Spar, Joker)
with filtering the official site doesn't offer — sorting by real unit price
(kr/kg, kr/l), combined price + category + stock filters, and price-change
history over time.

## How the data is sourced

meny.no / spar.no / joker.no are Next.js apps whose product search calls a
shared, **public, unauthenticated** NorgesGruppen backend:

```
GET https://platform-rest-prod.ngdata.no/api/episearch/{chainId}/products
```

Query params used here: `search` (empty string = whole catalog), `page`,
`page_size`, `types=products`, `popularity=true`, `showNotForSale=true`, and
`facet=Categories:{name}` to filter by category.

Confirmed chain IDs:

| Chain | chainId | Works on this endpoint? |
|-------|---------|--------------------------|
| Meny  | 1300    | yes |
| Spar  | 1210    | yes |
| Joker | 1220    | yes |
| Kiwi  | 1100    | no — returns `"Unknown chain id"` (Kiwi has no webshop) |

Each product record includes price, **`comparePricePerUnit` + `compareUnit`**
(the real per-kg/per-litre price the site's UI doesn't expose), category,
brand, EAN, stock/offer flags, and promotion info. Product images are at
`https://bilder.ngdata.no/{imagePath}/medium.jpg`.

**Elasticsearch 10k window limit:** a flat `page`/`page_size` sweep 500s once
`(page-1)*page_size` passes 10000 — Meny alone has ~11.6k products. Categories
fully partition each chain's catalog (verified: bucket counts sum exactly to
the unfiltered total, no remainder, and every category is well under 10k), so
ingestion fetches the category list first (`full_response=true` returns
Elasticsearch aggregations) and paginates each category separately via
`facet=Categories:{name}`.

No authentication, cookies, or spoofed User-Agent are required — the client
identifies itself honestly as `MatvarePris/1.0`.

**Product detail (ingredients, allergens, nutrition, origin)** isn't in the
bulk search API at all — it only exists embedded in each product's own page
(`/varer/{slug}`) as an escaped JSON blob inside a Next.js RSC
`self.__next_f.push([1,"..."])` script chunk. Scraping this for all ~21k
products on every ingest would be a lot of unnecessary load on their
servers, so it's fetched **on demand** the first time you open a product's
detail view, then cached in `product_details` (re-fetched after 30 days,
since this kind of data rarely changes).

**Offer discounts**: the search API also returns `pricePerUnitOriginal` and
`offerDiscountPerUnit` alongside the `isOffer` flag — the site's UI shows a
"TILBUD" badge but not how big the cut actually is. We store both
(`original_price`, `discount_amount` on `products`) and expose a computed
`discountPercent`, sortable via `sort=discount`. Mix-and-match promos like
"3 for 2" report `pricePerUnitOriginal === pricePerUnit` (no sticker-price
cut, the saving comes from the free item) — those are deliberately left
NULL rather than showing a fake 0% discount.

**Nutrition & allergens are searchable, not just viewable.** The full
"Næringsinnhold" panel (13 fields: energy, fat + mono/poly-unsaturated,
carbs, sugar, sugar alcohols ("polyoler" in the raw API — labeled
"Sukkeralkoholer" on the site), starch, fiber, protein, salt) and the
14-allergen list live in the same per-product page blob as the detail data
above, but scraping ~21k pages up front would be heavy. Instead a **background
crawler** (`ingest/nutritionCrawler.ts`) runs continuously in the backend
process at a deliberately slow, sequential pace (~1 request every 2-3s,
`NUTRITION_CRAWL_DELAY_MS` in `.env`), picking the next product where
`nutrition_fetched_at IS NULL`. A full backfill takes on the order of half a
day; after that, only genuinely new products (inserted by the regular catalog
ingest) join the backlog. Opening a product's detail modal also counts as
"crawled" (shares the same `syncProductNutrition()` helper), so on-demand
views don't get redundantly re-fetched later. Check progress via
`GET /api/nutrition-crawl/status`, or the **`/stats` page** in the UI
(live crawl progress bar + ETA, per-chain product counts, last ingest run
summary, catalog totals) — linked from the main page header.

The 13 nutrients are flattened onto `products` as real columns (not just a
JSONB blob) so they're filterable and sortable — `sort=carbs`, `sort=protein`,
etc., plus computed `sort=netCarbs` (carbs − fiber) and
`sort=proteinPercent`/`carbsPercent`/`fatPercent` (% of energy, the standard
macro-ratio view — protein/carbs use 4 kcal/g, fat uses 9 kcal/g). Bulk
"weigh at checkout" items (candy scoops, salad bars) sometimes carry
placeholder nutrition (kcal=1, protein=1, ...) rather than real per-100g
values; percentages are only computed when `energy_kcal >= 5` to avoid
nonsense ratios from that placeholder data.

Allergens are flattened too, into `contains_allergens text[]` (from the
`allergens` array's `code === "JA"` entries). Filtering supports both
**avoid** (`avoidAllergens=melk,gluten` — hide anything confirmed to contain
any of these) and **require** (`requireAllergens=...` — only show products
confirmed to contain all of these). These are asymmetric on purpose: a
product not yet crawled (`contains_allergens IS NULL`) still shows up under
"avoid" (we simply don't know yet) but is excluded under "require" (can't
confirm a match). This means "avoid" filters aren't a complete safety
guarantee until the background crawl has worked through the full catalog —
worth knowing if this is ever used for actual allergy avoidance rather than
diet-macro browsing.

**Dietary preferences (vegetarian/vegan/custom) via ingredient parsing.**
Category alone can't answer "does this contain meat" — a "Middag" ready-meal
category has both beef and vegetable lasagna. Fish/shellfish/molluscs/dairy/
egg are already covered for free by the legal allergen data above, but
**meat isn't a legal allergen category**, so it genuinely needs ingredient-
text parsing. `ingest/dietClassifier.ts` is a from-scratch heuristic parser:

- A paren-aware (and bracket-aware — some ingredient lists use `[...]`
  instead of `(...)`) recursive tokenizer, so sub-ingredient lists get
  checked too (e.g. "Gulost (pasteurisert melk, salt, vegetarisk løpe, ...)"
  checks every item inside the parens, not just "Gulost").
- Small curated dictionaries (meat/gelatin/honey terms) matched as
  substrings against each token, with a negation guard for compounds like
  "kjøttfri" (meat-*free*) and explicit safe-phrases like "vegetarisk løpe".
- **The "attempt it, log what failed, keep working from there" loop you get
  for free**: every product gets `contains_diet_flags` (`kjott`/`gelatin`/
  `honning`) and `diet_unmatched_tokens` — tokens that matched nothing.
  `GET /api/diet-classification/report` ranks unmatched tokens by frequency
  across the whole corpus — the actual worklist for improving the
  dictionaries, driven by real data rather than guessing (ingredient
  vocabulary is fairly Zipfian: a few hundred curated terms cover the large
  majority of occurrences). `npm run reclassify-diet` (or
  `POST /api/diet-classification/reclassify`) re-runs the classifier over
  already-cached ingredient text with **no network calls**, so the
  dictionaries can keep improving without re-crawling.
- Runs automatically as part of `syncProductNutrition()` (same crawl pass as
  nutrition/allergens above) — no extra requests to the storefront.

**Substring matching on Norwegian compounds is a real minefield** — found
(and fixed) via systematically spot-checking random samples of flagged
products against the actual source data, not just unit tests:
`"and"` (duck) matched inside `"behandlingsmiddel"` (processing agent);
`"okse"` (beef) matched inside `"boks"/"bokser"` (box/can — very common
packaging word); `"lam"` (lamb) matched inside `"kobalamin"` (vitamin B12),
`"cyklamat"` (a common sweetener), `"olamine"` (a cosmetic surfactant
suffix), and even the **"Kalamata"** olive variety name; `"hjort"` (deer)
matched inside `"hjortetakksalt"`/`"hjortronsalt"` (baker's ammonia and
cloudberry salt, both unrelated); `"gris"` (pig) matched at the exact
`honning`+`ristede` compound boundary in `"honningristede"` (honey-*roasted*
— extremely common on roasted nuts). Each was a genuine false positive on a
real product (bread, soda, salmon sushi, orange juice, a nut mix) before the
fix. **This is inherent to the approach, not fully solved** — the dictionary
will keep needing this kind of correction as new products surface new
collisions; that's expected, not a bug to eventually eliminate.

Filtering (`avoidDietTags`/`requireDietTags`, same asymmetric semantics as
the allergen params above) and the frontend's "Kosthold" chips/presets
("Vegetar"/"Vegan" one-click buttons that combine the diet tags with the
relevant allergen avoids) are described in the API and frontend sections
below. **This is a best-effort heuristic, explicitly not authoritative** —
surfaced with a visible disclaimer in the UI; don't rely on it for a genuine
allergy, only for casual diet browsing.

## Architecture

- **Postgres** — `products` (current snapshot per chain+EAN, indexed for
  filter/sort) and `price_history` (one row per product only when
  price/unit-price/offer/stock actually changes between ingestion runs).
- **Backend** (Node/TypeScript, Express) — REST API + the ingestion job +
  a `node-cron` scheduler for periodic refresh.
- **Frontend** (React + Vite) — search/filter/sort table with a price-history
  view (price and unit-price small-multiple line charts) per product.

## Running it

```
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000
- Postgres: localhost:5432 (user/db `matvarepris`, see `.env`)

On first start the backend runs migrations, then kicks off a full catalog
ingest for Meny, Spar, and Joker (a few minutes — dozens of paginated
requests per chain, throttled ~250ms apart to be polite to the upstream API).
After that it refreshes on the cron schedule in `.env` (`CRON_SCHEDULE`,
default every 6 hours), or on demand via the "Oppdater nå" button in the UI
(`POST /api/ingest/run`).

Copy `.env.example` to `.env` to customize ports, cron schedule, or whether
ingestion runs automatically on container startup (`INGEST_ON_STARTUP`).

## API

Other programs should use the versioned API under `/api/v1`, documented in
[`backend/docs/api.md`](backend/docs/api.md) (also served at
`GET /api/v1/info`). It's keyed by EAN, has batch lookup and a change feed.
The routes below are what this project's own frontend uses.

- `GET /api/products?chain=meny,spar&search=melk&includeCategories=Meieri%20%26%20egg&minUnitPrice=0&maxUnitPrice=20&onOffer=true&inStock=true&sort=unitPrice&order=asc&page=1&pageSize=50`
- `GET /api/products/:id/history` — price/offer/stock change history for one product
- `GET /api/products/:id/detail` — ingredients, allergens, nutrition, origin (fetched live on first request, then cached)
- `GET /api/categories?chain=meny` — distinct categories with counts
- `GET /api/chains` — chains with product counts and last-refreshed time
- `POST /api/ingest/run` / `GET /api/ingest/status` — manual refresh trigger
- `GET /api/nutrition-crawl/status` — background nutrition crawl progress (`{totalProducts, remaining, crawled}`)
- `GET /api/stats` — consolidated dashboard data for the `/stats` page: per-chain counts/last-updated, catalog aggregates (on-offer count, avg discount %, category count, price-history row count), nutrition crawl progress, and the last ingest run's per-chain summary
- `GET /api/diet-classification/report` — diet-parser coverage + the ranked unmatched-token frequency list (the dictionary-improvement worklist)
- `POST /api/diet-classification/reclassify` — re-run the diet classifier over already-cached ingredient text (no network calls) after editing `dietClassifier.ts`'s dictionaries

Nutrition/allergen/diet params on `GET /api/products`: `min`/`max` +
`Calories`, `Fat`, `SaturatedFat`, `Carbs`, `NetCarbs`, `Sugar`, `Fiber`,
`Protein`, `Salt`, `ProteinPercent`, `CarbsPercent`, `FatPercent` (e.g.
`maxNetCarbs=10&minProteinPercent=40`); `avoidAllergens`/`requireAllergens`
(comma-separated allergen keys: egg, fisk, gluten, melk, notter, peanotter,
selleri, sennep, sesam, skalldyr, soya, sulfitt, blotdyr, lupiner);
`avoidDietTags`/`requireDietTags` (comma-separated: kjott, gelatin, honning
— see the dietary-preferences section above).

**Category filtering is multi-select include/exclude**, not single-select —
`includeCategories`/`excludeCategories` (comma-separated `category_name`
values, both combinable). Deliberately operates on the **raw per-chain
category names**, not a normalized/canonical set: the three chains spell the
same concept differently (Meny "Fisk & skalldyr" / Spar "Fisk og skalldyr" /
Joker "Fisk/Skalldyr"; there are 42 distinct category strings in the DB for
~21 real-world categories). Auto-merging these risked silently conflating
genuinely different categories (e.g. Meny's "Bakeri" is fresh bread, while
"Bakevarer og kjeks" is baking supplies/cookies — a naive prefix match could
wrongly group them), so instead `GET /api/categories` lists every raw
variant and the frontend lets you select all the ones you actually want
(e.g. a vegetarian filter needs `Kjøtt` + all three fish-category spellings
+ `Kylling og fjærkre` to be complete across chains).

**All filter state lives in the URL** (`?chain=...&search=...&excludeCategories=...` etc.,
built/parsed by `frontend/src/filterParams.ts` — the single source of truth
shared between the API call and `window.history.replaceState`), so any
filtered view is a plain bookmarkable/shareable link. Page/search/etc.
updates use `replaceState`, not `pushState`, so filter tweaks don't spam
browser back-history.

**Persistent personal settings live in localStorage, not the URL** — the
opposite scope from the filters above, and deliberately so. The **`/settings`**
page currently manages one thing: categories you never want to see. Hiding
one there does two things: it disappears from the "Kategorier" chip list on
the main page (no point offering to toggle something you've permanently
excluded), and it's silently merged into every search's `excludeCategories`
(`frontend/src/api.ts`'s `fetchProducts`) — but **only at the point the API
call is built, never into `filtersToParams`/the URL itself**, so a link you
share reflects the filters you actually set, not your own hidden-category
preferences leaking onto whoever opens it. A small hint on the main page
("N kategorier skjult pga. innstillinger") links back to `/settings` so it's
never a silent, confusing gap. `frontend/src/settings.ts` is written to be
easy to extend to other hideable dimensions (allergens, diet tags, ...) if
that turns out to be useful later — currently just `hiddenCategories`.

## Notes / possible follow-ups

- Prices returned by this endpoint appear to be **chain-level defaults**
  (no `store_id` needed) rather than a specific store's price — fine for
  browsing/comparison, but if you want a specific local store's exact price
  you'd pass a `store_id` (a store GLN, visible in meny.no's network requests
  after picking a store).
- Kiwi isn't ingested (see table above) — nothing else to do there unless
  Kiwi later exposes the same episearch service.
- The ingest job re-checks every product on every run; only real changes get
  written to `price_history`, so the history table stays small relative to
  how often you refresh.
