export const ALLERGENS: { key: string; label: string }[] = [
  { key: "egg", label: "Egg" },
  { key: "fisk", label: "Fisk" },
  { key: "gluten", label: "Gluten" },
  { key: "melk", label: "Melk" },
  { key: "notter", label: "Nøtter" },
  { key: "peanotter", label: "Peanøtter" },
  { key: "selleri", label: "Selleri" },
  { key: "sennep", label: "Sennep" },
  { key: "sesam", label: "Sesam" },
  { key: "skalldyr", label: "Skalldyr" },
  { key: "soya", label: "Soya" },
  { key: "sulfitt", label: "Sulfitt" },
  { key: "blotdyr", label: "Bløtdyr" },
  { key: "lupiner", label: "Lupiner" },
];

// Ingredient-parsed, not legally standardized like the allergens above —
// see dietClassifier.ts (backend) for how these are derived and the
// accuracy caveat.
export const DIET_TAGS: { key: string; label: string }[] = [
  { key: "kjott", label: "Kjøtt" },
  { key: "gelatin", label: "Gelatin" },
  { key: "honning", label: "Honning" },
];

// One-click convenience presets: which allergen/diet chips to set to
// "avoid" at once. Fish/shellfish/molluscs/dairy/egg come from the legally
// standardized allergen data; meat/gelatin/honey come from our own
// ingredient parser.
export const DIET_PRESETS: { label: string; allergens: string[]; dietTags: string[] }[] = [
  { label: "Vegetar", allergens: ["fisk", "skalldyr", "blotdyr"], dietTags: ["kjott", "gelatin"] },
  {
    label: "Vegan",
    allergens: ["fisk", "skalldyr", "blotdyr", "melk", "egg"],
    dietTags: ["kjott", "gelatin", "honning"],
  },
];
