import { useState } from "react";
import type { Category, Chain, Filters } from "../types";
import { NutritionFilters } from "./NutritionFilters";
import { CategoryFilters } from "./CategoryFilters";
import { chainColorStyle, sortByChainOrder } from "../chainColors";

interface FilterBarProps {
  filters: Filters;
  chains: Chain[];
  categories: Category[];
  hiddenCategories: string[];
  hiddenChains: string[];
  onChange: (patch: Partial<Filters>) => void;
}

const NUTRITION_FILTER_KEYS: (keyof Filters)[] = [
  "minCalories",
  "maxCalories",
  "minFat",
  "maxFat",
  "minSaturatedFat",
  "maxSaturatedFat",
  "minCarbs",
  "maxCarbs",
  "minNetCarbs",
  "maxNetCarbs",
  "minSugar",
  "maxSugar",
  "minFiber",
  "maxFiber",
  "minProtein",
  "maxProtein",
  "minSalt",
  "maxSalt",
  "minProteinPercent",
  "maxProteinPercent",
  "minCarbsPercent",
  "maxCarbsPercent",
  "minFatPercent",
  "maxFatPercent",
];

function countActiveExpandedFilters(filters: Filters): number {
  const rangeCount = NUTRITION_FILTER_KEYS.filter((k) => filters[k]).length;
  const allergenCount = Object.keys(filters.allergenFilters).length;
  const dietCount = Object.keys(filters.dietFilters).length;
  const categoryCount = Object.keys(filters.categoryFilters).length;
  return rangeCount + allergenCount + dietCount + categoryCount;
}

export function FilterBar({ filters, chains, categories, hiddenCategories, hiddenChains, onChange }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActiveExpandedFilters(filters);
  const visibleChains = sortByChainOrder(
    chains.filter((c) => !hiddenChains.includes(c.key)),
    (c) => c.key,
  );

  function toggleChain(key: string) {
    const has = filters.chains.includes(key);
    const next = has ? filters.chains.filter((c) => c !== key) : [...filters.chains, key];
    onChange({ chains: next, page: 1 });
  }

  return (
    <div className="filter-bar-wrapper">
      <div className="filter-bar">
        <input
          className="search-input"
          type="text"
          placeholder="Søk etter produkt, merke…"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value, page: 1 })}
        />

        <div className="chain-chips-wrapper">
          <div className="chain-chips">
            {visibleChains.map((c) => (
              <div
                key={c.key}
                className={`chip chain-chip ${filters.chains.includes(c.key) ? "active" : ""}`}
                style={chainColorStyle(c.key)}
                onClick={() => toggleChain(c.key)}
              >
                {c.displayName} ({c.productCount})
              </div>
            ))}
          </div>
          {hiddenChains.length > 0 && (
            <div className="filter-hidden-hint">
              {hiddenChains.length} butikk{hiddenChains.length === 1 ? "" : "er"} skjult pga. innstillinger —{" "}
              <a href="/settings">endre i Innstillinger</a>
            </div>
          )}
        </div>

        <div className="filter-group price-range">
          pris
          <input
            type="number"
            placeholder="min"
            value={filters.minPrice}
            onChange={(e) => onChange({ minPrice: e.target.value, page: 1 })}
          />
          <span>–</span>
          <input
            type="number"
            placeholder="max"
            value={filters.maxPrice}
            onChange={(e) => onChange({ maxPrice: e.target.value, page: 1 })}
          />
        </div>

        <div className="filter-group price-range">
          enhetspris
          <input
            type="number"
            placeholder="min"
            value={filters.minUnitPrice}
            onChange={(e) => onChange({ minUnitPrice: e.target.value, page: 1 })}
          />
          <span>–</span>
          <input
            type="number"
            placeholder="max"
            value={filters.maxUnitPrice}
            onChange={(e) => onChange({ maxUnitPrice: e.target.value, page: 1 })}
          />
        </div>

        <label className="checkbox-group">
          <input
            type="checkbox"
            checked={filters.onOffer}
            onChange={(e) => onChange({ onOffer: e.target.checked, page: 1 })}
          />
          Kun tilbud
        </label>

        <label className="checkbox-group">
          <input
            type="checkbox"
            checked={filters.inStock}
            onChange={(e) => onChange({ inStock: e.target.checked, page: 1 })}
          />
          Kun på lager
        </label>

        <button className="expand-filters-button" onClick={() => setExpanded((v) => !v)}>
          Flere filtre {activeCount > 0 && `(${activeCount})`} {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div className="nutrition-filters">
          <CategoryFilters
            filters={filters}
            categories={categories}
            chains={chains}
            hiddenCategories={hiddenCategories}
            onChange={onChange}
          />
          <NutritionFilters filters={filters} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
