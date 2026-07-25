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
