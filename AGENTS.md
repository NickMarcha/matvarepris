# MatvarePris — agent orientation

> Edit this file, not `AGENTS.md`. The pre-commit hook (`.githooks/pre-commit`)
> copies it to `AGENTS.md`. Hooks need `git config core.hooksPath .githooks` once
> per clone.

Personal full-stack tool for browsing/filtering NorgesGruppen grocery data
(Meny, Spar, Joker) with better filtering than the official sites expose,
plus price-history tracking. Prices for the same EANs at other chains (Oda,
Bunnpris, Europris) come second-hand from Kassalapp's API, and Kiwi, Rema and
the Coop chains get prices people report through Susdi (#124). Node/TypeScript + Express backend, React/Vite
frontend, Postgres, all run via Docker Compose.

**Read `README.md` for the "why"** — API reverse-engineering notes, the
Elasticsearch pagination workaround, and the full rationale behind the diet
classifier. This file is the "where things are and what not to break" doc;
avoid duplicating README's narrative here, keep this one current as things
change.

## Running it

```
docker compose up --build
```
Frontend `:5173`, backend `:4000`, Postgres `:5432`. Copy `.env.example` to
`.env` first (git-ignored; already exists in this checkout).

**Gotchas specific to this setup:**
- `docker compose restart backend` does **not** reread `.env` — env vars are
  baked in at container creation. After editing `.env`, use
  `docker compose up -d backend` (or `frontend`) instead.
- Backend runs via `tsx watch` (bind-mounted `backend/src`) — hot reload is
  flaky on Windows bind mounts. If edits don't seem to take effect, restart
  the container.
- Migrations run automatically on backend startup (`db/migrate.ts`, tracked
  in `schema_migrations`) — no manual migration step. New schema changes go
  in a new `backend/src/db/migrations/000N_description.sql` file; never edit
  an already-applied one.
- `npm run reclassify-diet` (backend) re-runs the diet ingredient parser over
  already-cached text with **zero network calls** — use this (not a full
  re-crawl) after editing `dietClassifier.ts`'s dictionaries.

## Architecture map

```
backend/src/
  chains.ts                 chain registry: ngdata CHAINS (meny/spar/joker; Kiwi excluded, no webshop) + KASSALAPP_STORES code->key map
  server.ts                 express app wiring, migration run, scheduler + nutrition crawler startup
  clientAuth.ts             REPORT_API_KEYS ("name:key,..."): requireClient for POST/DELETE /v1/prices, identifyClient for catalog lookups
  catalog/catalog.ts        barcodes no chain sells: Kassalapp GET /products/ean then Open Food Facts, cached in catalog_products (30 d found, 7 d missing); SourcesDown when nothing found and a source didn't answer
  reported/reported.ts      reported prices: addReports, deleteReporter, refreshOffer (newest report <= 60 d -> products row), expireReported (runs after each ingest)
  db/
    pool.ts                 pg Pool, reads DATABASE_URL
    migrate.ts               migration runner, applies backend/src/db/migrations/*.sql in filename order
    migrations/0001..0005    schema history — see "Data model" below
  ingest/
    ngdataClient.ts          talks to the shared NorgesGruppen search API (fetchCategories, fetchProductPage)
    ingestChain.ts            per-category paginated bulk ingest, UPSERT + price_history change-detection
    runAll.ts / runOnce.ts    ingest entrypoints (all chains / CLI single run)
    scheduler.ts               node-cron wrapper, reads CRON_SCHEDULE
    kassalappClient.ts        POST /products/prices-bulk (100 EANs/call, spaced for the 60/min limit, 429 retry)
    kassalappIngest.ts        runs after the ngdata chains in runAll: prices our 8-14 digit EANs at other chains, needs KASSALAPP_API_KEY
    productDetail.ts          on-demand scraper: pulls ingredients/allergens/nutrition/origin from a product's own page (RSC JSON blob)
    nutritionSync.ts          syncProductNutrition() — shared by the on-demand detail route AND the background crawler; also calls classifyDiet()
    nutritionCrawler.ts       slow sequential background crawler, backlog = products WHERE nutrition_fetched_at IS NULL
    dietClassifier.ts         from-scratch heuristic ingredient-text parser (meat/gelatin/honey) — see "Diet classifier" below
    reclassifyDiet.ts / reclassifyDietOnce.ts   network-free bulk re-run of dietClassifier over cached text
  routes/
    products.ts                GET /api/products — filter/sort/paginate; also GET /api/products/:id/history
    productDetail.ts          GET /api/products/:id/detail — triggers syncProductNutrition on first view
    categories.ts / chains.ts  simple lookups
    ingest.ts                 POST /api/ingest/run, GET /api/ingest/status
    stats.ts                  GET /api/stats — dashboard aggregate for the /stats page
    dietClassification.ts     GET .../report (unmatched-token frequency), POST .../reclassify

frontend/src/
  types.ts                   Product/Filters/Chain/Category/Stats/ProductDetail shapes — mirrors backend API JSON shape
  filterParams.ts            Filters <-> URLSearchParams, single source of truth (filtersToParams/filtersToApiParams/paramsToFilters)
  settings.ts                AppSettings (hiddenCategories, hiddenChains) <-> localStorage — loadSettings/saveSettings
  api.ts                     all fetch() calls; resolveEffectiveChains() merges settings into API params (never into the URL)
  App.tsx                    main page: filter state (URL-driven) + settings state (localStorage-driven) + product table
  SettingsPage.tsx           /settings — toggle hidden chains/categories, unified `update(patch)` merge helper
  StatsPage.tsx               /stats — crawler progress, catalog aggregates
  main.tsx                    3-way routing by window.location.pathname (/, /settings, /stats) — plain <a> nav, no router lib
  components/
    FilterBar.tsx             search/chain/price/nutrition filter controls, chain chips filtered by hiddenChains
    CategoryFilters.tsx        category include/exclude chips, filtered by hiddenCategories
    NutritionFilters.tsx       macro/allergen/diet-tag range and avoid/require controls
    ProductTable.tsx          sortable results table (sticky <thead>)
    HistoryModal.tsx / ProductDetailSection.tsx   per-product price-history charts + on-demand detail fetch
    LineChart.tsx              small custom SVG line chart (no charting lib)
    CartDrawer.tsx             CartContext-backed shopping list (localStorage)
```

## Data model (Postgres)

- **`chains`** — key, chain_id, display_name, `source` (`ngdata` | `kassalapp`).
  ngdata rows are seeded by migration 0001; Kassalapp rows (chain_id NULL) are
  inserted by the ingest the first time a store has a fresh price.
- **Kassalapp rows in `products`** carry only title, price, compare price/unit
  and availability: no nutrition, category, image or slug. The compare price
  is computed from the package amount the ngdata row implies (price / kr per
  unit), because Kassalapp's own unit price is wrong on Oda and missing on
  Bunnpris. **Anything that crawls or scrapes product pages must filter to
  `source = 'ngdata'`** (see `nutritionCrawler.ts`): stamping
  `nutrition_fetched_at` on a Kassalapp row would make it the per-EAN
  representative and blank out the item's nutrition.
- **`products`** — one row per (chain_key, ean). Current snapshot only —
  price/stock/offer fields get overwritten on every ingest; `price_history`
  is where change-over-time lives. Columns of note:
  - Catalog: `title`, `category_name` (**raw per-chain string, not
    normalized** — see README), `brand`, `current_price`,
    `current_compare_price_per_unit` (the real kr/kg unit price),
    `original_price`/`discount_amount` (NULL unless a genuine sticker-price
    cut, not "3 for 2" style promos).
  - Nutrition (13 cols, `energy_kj` … `salt`): per-100g/ml, NULL = not yet
    crawled or not reported by source. `nutrition_fetched_at IS NULL` is the
    background crawler's backlog query.
  - `contains_allergens text[]` — legally-standardized allergen data, from
    `product_details.allergens`.
  - `contains_diet_flags text[]`, `diet_parse_status`,
    `diet_unmatched_tokens text[]` — heuristic parser output, deliberately a
    **separate** array from allergens (best-effort, not authoritative).
- **`product_details`** — 1:1 with products, cached scrape of the per-product
  page (ingredients, allergens jsonb, nutritional_content jsonb, origin).
  Re-fetched after 30 days.
- **`price_history`** — append-only, one row only when something actually
  changed between ingest runs.
- **`reported_prices`** — every price a client app reported (ean, chain,
  package price, observed_on, kind receipt|shelf, client, opaque reporter
  id). Never the store. For chains with `source = 'reported'` (kiwi, rema,
  extra, prix, mega, obs, coopmarked) the newest report from the last 60 days
  is written into `products` by `refreshOffer`, so search, history and
  `/changes` treat it like any other offer; `last_checked_at` is the report's
  date. Reports for ngdata/Kassalapp chains are stored but never touch
  `products`. Deleting a reporter rebuilds the rows their reports fed and
  deletes rows (with history) nobody else reported.
- **`catalog_products`** — what a barcode is when no chain we read sells it,
  from Kassalapp or Open Food Facts (ODbL, credit it). Looked up only for
  callers with a client key (shared Kassalapp budget); public reads get the
  cache. Fills in brand/picture/nutrition for items with no ngdata row.
- **`schema_migrations`** — tracks applied migration filenames.

Net carbs and the macro-%-of-energy fields (`proteinPercent`/etc.) are
**computed at query time in `routes/products.ts`**, not stored — see
`NET_CARBS_EXPR`/`percentOfEnergyExpr()`. Both are floor/guard-clamped
(`GREATEST(0, ...)`, `energy_kcal >= MIN_PLAUSIBLE_KCAL`) because of real
source-data inconsistencies (fiber > total carbs on some labels; placeholder
kcal=1 on bulk-bin items) — don't remove these guards.

## Conventions to preserve

- **Filters vs. Settings are different scopes, kept strictly separate.**
  Filters (`frontend/src/filterParams.ts`) are URL/session state — shareable
  links must reflect exactly what's in the URL. Settings
  (`frontend/src/settings.ts`) are personal, localStorage-only, and get
  merged into API calls **only inside `api.ts`**, never into
  `filtersToParams`/the URL. If you add a new hideable dimension (e.g.
  hidden allergens), follow this same pattern — don't let it leak into the
  URL.
- **Avoid vs. require filters are asymmetric on NULL/unknown**, applied
  consistently for allergens and diet tags (`routes/products.ts`): "avoid"
  treats an unclassified product as passing (permissive — we don't know yet,
  don't hide it); "require" treats it as failing (strict — can't confirm a
  match). This is intentional; don't "fix" it into symmetric behavior.
- **Category names are raw per-chain strings, never auto-normalized** across
  chains (Meny/Spar/Joker spell the same category differently). Don't add a
  fuzzy-merge — a prior naive approach risked silently conflating genuinely
  different categories. `GET /api/categories` lists every raw variant; the
  frontend lets users multi-select the ones they want.
- **New sortable/filterable nutrition or price fields** go through the same
  three-registry pattern in `routes/products.ts`: `SORT_COLUMNS` (or a
  computed expr function), `RANGE_FILTER_COLUMNS` for simple min/max, and a
  matching entry in `frontend/src/filterParams.ts`'s `RANGE_FILTER_KEYS` +
  `types.ts`'s `SortKey`/`Filters`. Keep all three in sync.
- **Migrations are additive and numbered**, applied once and tracked by
  filename — never edit a migration that's already shipped; add a new one.
- Frontend uses **plain multi-page navigation** (`<a href>` + a
  pathname-switch in `main.tsx`), not a client-side router — this works
  because all page state is either URL-derived or localStorage-derived, so a
  full reload always reconstructs correctly. Keep new pages consistent with
  that, don't introduce SPA routing for just one page.

## Diet classifier (`ingest/dietClassifier.ts`)

Heuristic, substring-matching, **explicitly never "done"** — improved via a
log-driven loop, not upfront correctness. Every classified product records
`diet_unmatched_tokens`; `GET /api/diet-classification/report` ranks these by
corpus-wide frequency as the actual worklist. After editing the term
dictionaries, run `npm run reclassify-diet` (no network calls, re-parses
cached ingredient text) and spot-check a random sample of newly-flagged
products against real data — unit tests alone have not caught the real bugs
here; every past false positive was found by spot-checking actual products.

**Known collision classes already fixed once — avoid reintroducing them**
when adding new terms: short animal-term substrings tend to collide with
unrelated Norwegian compounds (`and`→`behandlingsmiddel`, `okse`→`boks`,
`lam`→`kobalamin`/`cyklamat`/`Kalamata`, `hjort`→`hjortetakksalt`,
`gris`→`honningristede`). Prefer specific compound forms
(`oksekjøtt`, `lammefilet`, …) over bare short roots. HTML tags and
`[...]`-style sub-ingredient brackets are normalized before tokenizing —
don't bypass `tokenize()`/`extractParenContent()` with a raw string match.

## API quick reference

Full param list is in README's "API" section. Backend: `GET /api/products`
(filter/sort/paginate), `/api/products/:id/history`, `/api/products/:id/detail`,
`/api/categories`, `/api/chains`, `/api/stats`, `/api/nutrition-crawl/status`,
`/api/ingest/run` (POST) + `/api/ingest/status`,
`/api/diet-classification/report` + `/reclassify` (POST).

The two POSTs need `Authorization: Bearer $ADMIN_API_KEY` when that env var
is set (`src/auth.ts`); unset, they're open, for local dev. `POST /api/v1/prices`
and `DELETE /api/v1/prices/reporters/:reporter` need a client key from
`REPORT_API_KEYS` instead (`src/clientAuth.ts`); unset, nobody can report.

**`/api/v1/*` is the contract for other programs** (the meal planner, anyone
the API is shared with), documented in `backend/docs/api.md` and served by
`GET /api/v1/info`. The unversioned routes above are the UI's and may change
freely; v1 may not. If a change would matter to a v1 caller (renamed or
removed field, changed meaning or status code, new requirement), bump
`Contract version:` in the guide and add a line under its Changes section.
The pre-push hook (`.githooks/guide-check`, enable with
`git config core.hooksPath .githooks`) warns when watched files changed since
the guide was last stamped; re-read it, then `.githooks/guide-check --write`.
`GET /api/v1/changes` is fed by the `products_track_change` trigger
(migration 0007); add any new client-visible column to its comparisons.

v1 response shapes live once, as zod schemas in `routes/v1Schemas.ts`. The
mappers in `v1.ts` are typed with them (a missing or extra field fails
`tsc`), `routes/v1OpenApi.ts` generates `/api/v1/openapi.json` from them, and
`npm run check-api [-- <base url>]` parses real responses with them. Run
`check-api` after touching v1; it's read-only, so pointing it at production
is fine.

## UI work

Follow `Uncodixify.md` from github.com/NickMarcha/agents.md (private): no
pills, no uppercase eyebrow labels, no gradients or big shadows, 8-10px radii
at most, and keep this project's existing warm-gray palette in `styles.css`
rather than inventing colors. User-facing text follows `Unslop.md` from the
same repo.

## Verifying frontend changes

No automated frontend test suite exists — verify UI changes by actually
running the app (`docker compose up`) and checking in a browser (this
session has `claude-in-chrome` tools available). Type-check via
`cd frontend && npx tsc --noEmit` / `cd backend && npx tsc --noEmit` before
considering a change done.
