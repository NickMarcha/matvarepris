import type { CSSProperties } from "react";

// Brand colors per NorgesGruppen chain (see chains.ts on the backend for the
// canonical key list). Primary = brand's dominant color, secondary = its
// accent/text color — e.g. Spar's real logo is a red disc with green text,
// which is exactly primary/secondary here.
export const CHAIN_COLORS: Record<string, { primary: string; secondary: string }> = {
  meny: { primary: "oklch(0.52 0.2 21.79)", secondary: "oklch(1 0 0)" },
  spar: { primary: "oklch(0.59 0.22 26.88)", secondary: "oklch(0.64 0.17 149.67)" },
  joker: { primary: "oklch(0.57 0.13 156.58)", secondary: "oklch(0.91 0.19 102.09)" },
};

// Exposes the pair as CSS custom properties so a shared stylesheet rule (see
// .chain-chip / .chain-badge / .category-chain-label in styles.css) can pick
// them up per element without one CSS rule per chain.
export function chainColorStyle(chainKey: string): CSSProperties {
  const colors = CHAIN_COLORS[chainKey];
  if (!colors) return {};
  return {
    "--chain-primary": colors.primary,
    "--chain-secondary": colors.secondary,
  } as CSSProperties;
}

// Fixed display order for whenever multiple chain badges/chips render next
// to each other (filter chips, "Kjede" cell, cart store lists, etc.).
// Deliberately a stable constant rather than "whatever order this particular
// array arrived in" (price order, DB scan order, Set insertion order, ...) —
// those vary per row/response and read as visually random when several
// badges sit side by side.
const CHAIN_ORDER = ["joker", "meny", "spar"];

function chainSortIndex(chainKey: string): number {
  const idx = CHAIN_ORDER.indexOf(chainKey);
  return idx === -1 ? CHAIN_ORDER.length : idx;
}

export function sortByChainOrder<T>(items: T[], getChainKey: (item: T) => string): T[] {
  return [...items].sort((a, b) => chainSortIndex(getChainKey(a)) - chainSortIndex(getChainKey(b)));
}
