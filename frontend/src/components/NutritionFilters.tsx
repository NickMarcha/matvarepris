import { Fragment } from "react";
import { ALLERGENS, DIET_PRESETS, DIET_TAGS } from "../constants";
import type { AllergenMode, Filters } from "../types";

interface NutritionFiltersProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}

interface RangeRowProps {
  label: string;
  unit: string;
  minKey: keyof Filters;
  maxKey: keyof Filters;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}

function RangeRow({ label, unit, minKey, maxKey, filters, onChange }: RangeRowProps) {
  return (
    <div className="filter-group price-range nutrition-range-row">
      <span className="nutrition-range-label">
        {label} <span className="nutrition-unit">({unit})</span>
      </span>
      <input
        type="number"
        placeholder="min"
        value={filters[minKey] as string}
        onChange={(e) => onChange({ [minKey]: e.target.value, page: 1 } as Partial<Filters>)}
      />
      <span>–</span>
      <input
        type="number"
        placeholder="max"
        value={filters[maxKey] as string}
        onChange={(e) => onChange({ [maxKey]: e.target.value, page: 1 } as Partial<Filters>)}
      />
    </div>
  );
}

function cycleMode(
  record: Record<string, AllergenMode>,
  key: string,
): Record<string, AllergenMode> {
  const current = record[key];
  const next: AllergenMode | undefined =
    current === undefined ? "avoid" : current === "avoid" ? "require" : undefined;

  const updated = { ...record };
  if (next === undefined) delete updated[key];
  else updated[key] = next;
  return updated;
}

export function NutritionFilters({ filters, onChange }: NutritionFiltersProps) {
  function cycleAllergen(key: string) {
    onChange({ allergenFilters: cycleMode(filters.allergenFilters, key), page: 1 });
  }

  function cycleDietTag(key: string) {
    onChange({ dietFilters: cycleMode(filters.dietFilters, key), page: 1 });
  }

  function applyPreset(preset: (typeof DIET_PRESETS)[number]) {
    const allergenFilters = { ...filters.allergenFilters };
    for (const a of preset.allergens) allergenFilters[a] = "avoid";
    const dietFilters = { ...filters.dietFilters };
    for (const d of preset.dietTags) dietFilters[d] = "avoid";
    onChange({ allergenFilters, dietFilters, page: 1 });
  }

  function clearDietAndAllergens() {
    onChange({ allergenFilters: {}, dietFilters: {}, page: 1 });
  }

  return (
    <Fragment>
      <div className="nutrition-filters-section">
        <div className="nutrition-filters-title">Hurtigvalg</div>
        <div className="diet-preset-row">
          {DIET_PRESETS.map((preset) => (
            <button key={preset.label} onClick={() => applyPreset(preset)}>
              {preset.label}
            </button>
          ))}
          <button onClick={clearDietAndAllergens}>Nullstill kosthold/allergener</button>
        </div>
      </div>

      <div className="nutrition-filters-section">
        <div className="nutrition-filters-title">
          Kosthold <span className="nutrition-unit">(fra ingredienslisten — se forbehold nederst)</span>
        </div>
        <div className="toggle-chip-grid">
          {DIET_TAGS.map((d) => {
            const mode = filters.dietFilters[d.key];
            const chipClass = mode === "avoid" ? "chip-exclude" : mode === "require" ? "chip-include" : "";
            return (
              <div key={d.key} className={`chip ${chipClass}`} onClick={() => cycleDietTag(d.key)}>
                {d.label}
                {mode === "avoid" && <span className="chip-tag"> unngå</span>}
                {mode === "require" && <span className="chip-tag"> krev</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="nutrition-filters-section">
        <div className="nutrition-filters-title">
          Allergener <span className="nutrition-unit">(klikk for å unngå, klikk igjen for å kreve)</span>
        </div>
        <div className="toggle-chip-grid">
          {ALLERGENS.map((a) => {
            const mode = filters.allergenFilters[a.key];
            const chipClass = mode === "avoid" ? "chip-exclude" : mode === "require" ? "chip-include" : "";
            return (
              <div key={a.key} className={`chip ${chipClass}`} onClick={() => cycleAllergen(a.key)}>
                {a.label}
                {mode === "avoid" && <span className="chip-tag"> unngå</span>}
                {mode === "require" && <span className="chip-tag"> krev</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="nutrition-filters-section">
        <div className="nutrition-filters-title">Næringsinnhold (per 100 g/ml)</div>
        <div className="nutrition-range-grid">
          <RangeRow label="Kalorier" unit="kcal" minKey="minCalories" maxKey="maxCalories" filters={filters} onChange={onChange} />
          <RangeRow label="Fett" unit="g" minKey="minFat" maxKey="maxFat" filters={filters} onChange={onChange} />
          <RangeRow label="hvorav mettet" unit="g" minKey="minSaturatedFat" maxKey="maxSaturatedFat" filters={filters} onChange={onChange} />
          <RangeRow label="Karbohydrater" unit="g" minKey="minCarbs" maxKey="maxCarbs" filters={filters} onChange={onChange} />
          <RangeRow label="Netto karbo" unit="g" minKey="minNetCarbs" maxKey="maxNetCarbs" filters={filters} onChange={onChange} />
          <RangeRow label="hvorav sukker" unit="g" minKey="minSugar" maxKey="maxSugar" filters={filters} onChange={onChange} />
          <RangeRow label="Kostfiber" unit="g" minKey="minFiber" maxKey="maxFiber" filters={filters} onChange={onChange} />
          <RangeRow label="Protein" unit="g" minKey="minProtein" maxKey="maxProtein" filters={filters} onChange={onChange} />
          <RangeRow label="Salt" unit="g" minKey="minSalt" maxKey="maxSalt" filters={filters} onChange={onChange} />
        </div>
      </div>

      <div className="nutrition-filters-section">
        <div className="nutrition-filters-title">Makro-andel (% av kalorier)</div>
        <div className="nutrition-range-grid">
          <RangeRow label="Protein" unit="%" minKey="minProteinPercent" maxKey="maxProteinPercent" filters={filters} onChange={onChange} />
          <RangeRow label="Karbohydrater" unit="%" minKey="minCarbsPercent" maxKey="maxCarbsPercent" filters={filters} onChange={onChange} />
          <RangeRow label="Fett" unit="%" minKey="minFatPercent" maxKey="maxFatPercent" filters={filters} onChange={onChange} />
        </div>
      </div>

      <div className="nutrition-filters-note">
        Allergendata er lovpålagt standardisert og pålitelig. Produkter som ikke er sjekket enda vises fortsatt
        under «unngå»-filtre (vi vet rett og slett ikke ennå), men skjules under «krev»-filtre.
        <br />
        Kosthold-merkene (kjøtt/gelatin/honning) kommer derimot fra vår egen automatiske analyse av
        ingredienslisten, ikke offisielle data — de blir bedre over tid, men kan inneholde feil. Ikke stol
        blindt på dem ved alvorlig allergi; sjekk produktet selv ved tvil.
      </div>
    </Fragment>
  );
}
