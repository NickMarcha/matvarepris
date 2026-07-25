import type { ChainConfig } from "./types.js";

// NorgesGruppen chains confirmed to expose the shared ngdata product-search API.
// Kiwi (chainId 1100) does not run a webshop and returns "Unknown chain id" on
// this endpoint, so it is intentionally left out.
export const CHAINS: ChainConfig[] = [
  { key: "meny", chainId: 1300, displayName: "Meny" },
  { key: "spar", chainId: 1210, displayName: "Spar" },
  { key: "joker", chainId: 1220, displayName: "Joker" },
];
