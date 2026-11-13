import { CHAINS } from "../chains.js";
import { ingestChain, type IngestSummary } from "./ingestChain.js";
import { ingestKassalapp, kassalappEnabled } from "./kassalappIngest.js";

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
    // Uses the EANs the ngdata run just refreshed. A Kassalapp failure
    // shouldn't throw away the ngdata summaries, so it only logs.
    if (kassalappEnabled()) {
      console.log("[ingest] starting kassalapp");
      try {
        const summary = await ingestKassalapp();
        console.log("[ingest] finished kassalapp:", summary);
        summaries.push(summary);
      } catch (err) {
        console.error("[ingest] kassalapp failed:", err);
      }
    } else {
      console.log("[ingest] KASSALAPP_API_KEY not set, skipping kassalapp");
    }
  } finally {
    running = false;
    lastRun = { startedAt, finishedAt: new Date().toISOString(), summaries };
  }

  return summaries;
}
