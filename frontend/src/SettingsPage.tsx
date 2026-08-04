import { useEffect, useState } from "react";
import { fetchCategories, fetchChains } from "./api";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import type { Category, Chain } from "./types";
import { chainColorStyle, sortByChainOrder } from "./chainColors";

export default function SettingsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories([])
      .then(setCategories)
      .catch((err) => setError(String(err)));
    fetchChains()
      .then(setChains)
      .catch((err) => setError(String(err)));
  }, []);

  function update(patch: Partial<AppSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  function toggleCategory(name: string) {
    const hiddenCategories = settings.hiddenCategories.includes(name)
      ? settings.hiddenCategories.filter((c) => c !== name)
      : [...settings.hiddenCategories, name];
    update({ hiddenCategories });
  }

  function toggleChain(key: string) {
    const hiddenChains = settings.hiddenChains.includes(key)
      ? settings.hiddenChains.filter((c) => c !== key)
      : [...settings.hiddenChains, key];
    update({ hiddenChains });
  }

  // Categories come back one row per (chain, name) — section them the same
  // way CategoryFilters does on the main page, even though hiding a category
  // here is store-agnostic (hiddenCategories is keyed by name only, so a
  // name shared across chains toggles together wherever it appears).
  const distinctCategoryCount = new Set(categories.map((c) => c.name)).size;

  const byChain = new Map<string, Category[]>();
  for (const c of categories) {
    const list = byChain.get(c.chain);
    if (list) list.push(c);
    else byChain.set(c.chain, [c]);
  }
  const chainOrder = sortByChainOrder(
    [...chains.map((c) => c.key), ...byChain.keys()].filter((key, i, arr) => byChain.has(key) && arr.indexOf(key) === i),
    (key) => key,
  );
  function chainDisplayName(key: string): string {
    return chains.find((c) => c.key === key)?.displayName ?? key;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Innstillinger</h1>
          <div className="subtitle">Personlige preferanser, lagret i denne nettleseren (localStorage)</div>
        </div>
        <a className="back-link" href="/">
          ← Tilbake til produkter
        </a>
      </header>

      {error && <div className="empty-state">Feil: {error}</div>}

      <div className="stats-section">
        <h2>Skjulte butikker</h2>
        <p className="settings-description">
          Butikker du skjuler her vises ikke lenger som valg i det vanlige filtervinduet, og holdes automatisk
          utenfor søkeresultatene — uansett hvilke andre filtre du bruker. Dette gjelder kun denne nettleseren
          og påvirker ikke lenker du deler med andre.
        </p>
        <div className="settings-summary">
          {settings.hiddenChains.length} av {chains.length} butikker skjult
          {settings.hiddenChains.length > 0 && (
            <button className="link-button" onClick={() => update({ hiddenChains: [] })}>
              Vis alle igjen
            </button>
          )}
        </div>
        <div className="toggle-chip-grid">
          {sortByChainOrder(chains, (c) => c.key).map((c) => {
            const hidden = settings.hiddenChains.includes(c.key);
            return (
              <div
                key={c.key}
                className={`chip ${hidden ? "chip-exclude" : ""}`}
                onClick={() => toggleChain(c.key)}
              >
                {c.displayName} ({c.productCount})
                {hidden && <span className="chip-tag"> skjult</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="stats-section">
        <h2>Skjulte kategorier</h2>
        <p className="settings-description">
          Kategorier du skjuler her vises ikke lenger som valg i det vanlige filtervinduet, og produkter i dem
          holdes automatisk utenfor søkeresultatene — uansett hvilke andre filtre du bruker. Dette gjelder kun
          denne nettleseren og påvirker ikke lenker du deler med andre.
        </p>
        <div className="settings-summary">
          {settings.hiddenCategories.length} av {distinctCategoryCount} kategorier skjult
          {settings.hiddenCategories.length > 0 && (
            <button className="link-button" onClick={() => update({ hiddenCategories: [] })}>
              Vis alle igjen
            </button>
          )}
        </div>
        {chainOrder.map((key) => {
          const sorted = [...(byChain.get(key) ?? [])].sort((a, b) => a.name.localeCompare(b.name, "no"));
          return (
            <div className="category-chain-section" key={key}>
              <div className="category-chain-label" style={chainColorStyle(key)}>
                {chainDisplayName(key)}
              </div>
              <div className="toggle-chip-grid">
                {sorted.map((c) => {
                  const hidden = settings.hiddenCategories.includes(c.name);
                  return (
                    <div
                      key={`${c.chain}-${c.name}`}
                      className={`chip ${hidden ? "chip-exclude" : ""}`}
                      onClick={() => toggleCategory(c.name)}
                    >
                      {c.name} ({c.count})
                      {hidden && <span className="chip-tag"> skjult</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
