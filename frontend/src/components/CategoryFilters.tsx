import type { Category, CategoryMode, Chain, Filters } from "../types";
import { chainColorStyle, sortByChainOrder } from "../chainColors";

interface CategoryFiltersProps {
  filters: Filters;
  categories: Category[];
  chains: Chain[];
  hiddenCategories: string[];
  onChange: (patch: Partial<Filters>) => void;
}

export function CategoryFilters({ filters, categories, chains, hiddenCategories, onChange }: CategoryFiltersProps) {
  function cycleCategory(name: string) {
    const current = filters.categoryFilters[name];
    const next: CategoryMode | undefined =
      current === undefined ? "exclude" : current === "exclude" ? "include" : undefined;

    const updated = { ...filters.categoryFilters };
    if (next === undefined) delete updated[name];
    else updated[name] = next;

    onChange({ categoryFilters: updated, page: 1 });
  }

  const visible = categories.filter((c) => !hiddenCategories.includes(c.name));

  const byChain = new Map<string, Category[]>();
  for (const c of visible) {
    const list = byChain.get(c.chain);
    if (list) list.push(c);
    else byChain.set(c.chain, [c]);
  }

  // Fixed chain order (matches the store chips elsewhere), not whatever
  // order chains.ts/categories.ts happened to return.
  const chainOrder = sortByChainOrder(
    [...chains.map((c) => c.key), ...byChain.keys()].filter((key, i, arr) => byChain.has(key) && arr.indexOf(key) === i),
    (key) => key,
  );

  function displayName(key: string): string {
    return chains.find((c) => c.key === key)?.displayName ?? key;
  }

  return (
    <div className="nutrition-filters-section">
      <div className="nutrition-filters-title">
        Kategorier{" "}
        <span className="nutrition-unit">
          (klikk for å ekskludere, klikk igjen for å vise kun denne — kjedene staver kategorinavn ulikt, f.eks.
          «Fisk &amp; skalldyr» / «Fisk og skalldyr» / «Fisk/Skalldyr», så velg alle varianter du vil
          ekskludere)
        </span>
      </div>
      {chainOrder.map((key) => {
        const sorted = [...(byChain.get(key) ?? [])].sort((a, b) => a.name.localeCompare(b.name, "no"));
        return (
          <div className="category-chain-section" key={key}>
            <div className="category-chain-label" style={chainColorStyle(key)}>
              {displayName(key)}
            </div>
            <div className="toggle-chip-grid">
              {sorted.map((c) => {
                const mode = filters.categoryFilters[c.name];
                return (
                  <div
                    key={`${c.chain}-${c.name}`}
                    className={`chip ${mode ? `chip-${mode}` : ""}`}
                    onClick={() => cycleCategory(c.name)}
                  >
                    {c.name} ({c.count})
                    {mode === "exclude" && <span className="chip-tag"> ekskluder</span>}
                    {mode === "include" && <span className="chip-tag"> kun denne</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {hiddenCategories.length > 0 && (
        <div className="filter-hidden-hint">
          {hiddenCategories.length} kategori{hiddenCategories.length === 1 ? "" : "er"} skjult pga.
          innstillinger (holdes automatisk utenfor søket) — <a href="/settings">endre i Innstillinger</a>
        </div>
      )}
    </div>
  );
}
