import cron from "node-cron";
import { runAllChains } from "./runAll.js";

export function startScheduler(cronExpression: string): void {
  if (!cron.validate(cronExpression)) {
    console.warn(`[scheduler] invalid CRON_SCHEDULE "${cronExpression}", skipping scheduled ingest`);
    return;
  }

  cron.schedule(cronExpression, () => {
    console.log(`[scheduler] triggering scheduled ingest (${cronExpression})`);
    runAllChains().catch((err) => console.error("[scheduler] ingest failed:", err));
  });

  console.log(`[scheduler] scheduled ingest with cron "${cronExpression}"`);
}
