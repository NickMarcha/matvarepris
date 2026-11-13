import type { ChainConfig } from "./types.js";

// NorgesGruppen chains confirmed to expose the shared ngdata product-search API.
// Kiwi (chainId 1100) does not run a webshop and returns "Unknown chain id" on
// this endpoint, so it is intentionally left out.
export const CHAINS: ChainConfig[] = [
  { key: "meny", chainId: 1300, displayName: "Meny" },
  { key: "spar", chainId: 1210, displayName: "Spar" },
  { key: "joker", chainId: 1220, displayName: "Joker" },
];

// Kassalapp store codes we take prices from, mapped to our chain keys. Only
// grocery chains; bookshops, hardware and wholesale (ENGROSSNETT_NO) are left
// out. MENY_NO/SPAR_NO/JOKER_NO are skipped because ngdata gives us those
// first-hand. As of 2026-11 only Oda and Bunnpris have fresh prices; Kassalapp
// stopped updating Kiwi and Coop in 2024, and the freshness check in
// kassalappIngest.ts keeps those out until it picks them up again.
export const KASSALAPP_STORES: Record<string, { key: string; displayName: string }> = {
  ODA_NO: { key: "oda", displayName: "Oda" },
  BUNNPRIS: { key: "bunnpris", displayName: "Bunnpris" },
  KIWI: { key: "kiwi", displayName: "Kiwi" },
  REMA_1000: { key: "rema", displayName: "Rema 1000" },
  COOP_NO: { key: "coop", displayName: "Coop" },
  COOP_EXTRA: { key: "extra", displayName: "Coop Extra" },
  COOP_MEGA: { key: "mega", displayName: "Coop Mega" },
  COOP_OBS: { key: "obs", displayName: "Coop Obs" },
  COOP_PRIX: { key: "prix", displayName: "Coop Prix" },
  COOP_MARKED: { key: "coopmarked", displayName: "Coop Marked" },
  EUROPRIS_NO: { key: "europris", displayName: "Europris" },
};

export const NGDATA_STORE_CODES = new Set(["MENY_NO", "SPAR_NO", "JOKER_NO"]);
