import { useEffect, useState } from "react";
import { fetchCategories, fetchChains, fetchIngestStatus, fetchProducts, triggerIngest } from "./api";
import { useCart } from "./CartContext";
import { filtersToParams, paramsToFilters } from "./filterParams";
import { loadSettings, type AppSettings } from "./settings";
import { FilterBar } from "./components/FilterBar";
import { ProductTable } from "./components/ProductTable";
import { HistoryModal } from "./components/HistoryModal";
import { CartDrawer } from "./components/CartDrawer";
import type { Category, Chain, Filters, Product, SortKey } from "./types";

export default function App() {
  const [filters, setFilters] = useState<Filters>(() => paramsToFilters(new URLSearchParams(window.location.search)));
  const [chains, setChains] = useState<Chain[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [ingestRunning, setIngestRunning] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [showNutritionColumns, setShowNutritionColumns] = useState(false);
  // Bumped whenever the product detail modal closes — opening it can trigger
  // an on-demand ingredient/diet classification for that one product, which
  // the already-rendered list has no way to know about otherwise.
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings] = useState<AppSettings>(() => loadSettings());
  const { addItem, totalCount, totalPrice } = useCart();

  const allChainKeys = chains.map((c) => c.key);

  useEffect(() => {
    fetchChains().then(setChains).catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    fetchCategories(filters.chains, settings.hiddenChains, allChainKeys)
      .then(setCategories)
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.chains, settings.hiddenChains, chains]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      fetchProducts(filters, settings, allChainKeys)
        .then((res) => {
          setProducts(res.items);
          setTotal(res.total);
          setError(null);
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshKey, settings, chains]);

  // Keeps the URL a live, bookmarkable/shareable snapshot of the current
  // filters. replaceState (not push) so filter tweaks don't spam browser
  // history — only real navigation should do that.
  useEffect(() => {
    const query = filtersToParams(filters).toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [filters]);

  useEffect(() => {
    if (!ingestRunning) return;
    const interval = setInterval(() => {
      fetchIngestStatus().then((status) => {
        if (!status.running) {
          setIngestRunning(false);
          fetchChains().then(setChains).catch(() => {});
        }
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [ingestRunning]);

  function patchFilters(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function handleSortChange(sort: SortKey) {
    setFilters((prev) => ({
      ...prev,
      sort,
      order: prev.sort === sort && prev.order === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }

  async function handleRefresh() {
    setIngestRunning(true);
    await triggerIngest();
  }

  const maxPage = Math.max(1, Math.ceil(total / filters.pageSize));

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>MatvarePris</h1>
          <div className="subtitle">
            Bedre søk og filtrering for NorgesGruppen-kjedenes nettbutikkdata (Meny, Spar, Joker)
          </div>
        </div>
        <div className="refresh-bar">
          {chains.length > 0 && (
            <span>
              Sist oppdatert:{" "}
              {chains
                .map((c) => c.lastCheckedAt)
                .filter(Boolean)
                .sort()
                .at(-1)
                ? new Date(
                    chains.map((c) => c.lastCheckedAt).filter(Boolean).sort().at(-1) as string,
                  ).toLocaleString("no-NO")
                : "aldri"}
            </span>
          )}
          <button onClick={handleRefresh} disabled={ingestRunning}>
            {ingestRunning ? "Oppdaterer…" : "Oppdater nå"}
          </button>
          <button onClick={() => setCartOpen(true)}>
            Handlekurv ({totalCount}) — {totalPrice.toFixed(2)} kr
          </button>
          <a className="back-link" href="/settings">
            Innstillinger →
          </a>
          <a className="back-link" href="/stats">
            Statistikk →
          </a>
        </div>
      </header>

      <FilterBar
        filters={filters}
        chains={chains}
        categories={categories}
        hiddenCategories={settings.hiddenCategories}
        hiddenChains={settings.hiddenChains}
        onChange={patchFilters}
      />

      <div className="results-meta">
        <span>{total.toLocaleString("no-NO")} produkter</span>
        <label className="checkbox-group">
          <input
            type="checkbox"
            checked={showNutritionColumns}
            onChange={(e) => setShowNutritionColumns(e.target.checked)}
          />
          Vis næringskolonner
        </label>
        <span>
          Side {filters.page} av {maxPage}
        </span>
      </div>

      {loading && <div className="loading-state">Laster…</div>}
      {error && <div className="empty-state">Feil: {error}</div>}
      {!loading && !error && products.length === 0 && (
        <div className="empty-state">Ingen produkter matcher filtrene dine.</div>
      )}

      {!loading && !error && products.length > 0 && (
        <ProductTable
          items={products}
          sort={filters.sort}
          order={filters.order}
          onSortChange={handleSortChange}
          onSelect={setSelected}
          onAddToCart={addItem}
          showNutritionColumns={showNutritionColumns}
        />
      )}

      <div className="pagination">
        <button disabled={filters.page <= 1} onClick={() => patchFilters({ page: filters.page - 1 })}>
          Forrige
        </button>
        <span>
          {filters.page} / {maxPage}
        </span>
        <button disabled={filters.page >= maxPage} onClick={() => patchFilters({ page: filters.page + 1 })}>
          Neste
        </button>
      </div>

      {selected && (
        <HistoryModal
          productId={selected.id}
          onClose={() => {
            setSelected(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
    </div>
  );
}
