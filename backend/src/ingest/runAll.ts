import { CHAINS } from "../chains.js";
import { ingestChain, type IngestSummary } from "./ingestChain.js";

let running = false;
let lastRun: { startedAt: string; finishedAt: string; summaries: IngestSummary[] } | null = null;

export function getIngestStatus() {
  return { running, lastRun };
}

export async function runAllChains(): Promise<IngestSummary[]> {
  if (running) {
    throw new Error("Ingest already in progress");
  }
  running = true;
  const startedAt = new Date().toISOString();
  const summaries: IngestSummary[] = [];

  try {
    for (const chain of CHAINS) {
      console.log(`[ingest] starting ${chain.key} (chainId=${chain.chainId})`);
      const summary = await ingestChain(chain);
      console.log(`[ingest] finished ${chain.key}:`, summary);
      summaries.push(summary);
    }
  } finally {
    running = false;
    lastRun = { startedAt, finishedAt: new Date().toISOString(), summaries };
  }

  return summaries;
}
