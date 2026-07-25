import "dotenv/config";
import express from "express";
import cors from "cors";
import { runMigrations } from "./db/migrate.js";
import { startScheduler } from "./ingest/scheduler.js";
import { runAllChains } from "./ingest/runAll.js";
import { startNutritionCrawler } from "./ingest/nutritionCrawler.js";
import productsRouter from "./routes/products.js";
import productDetailRouter from "./routes/productDetail.js";
import categoriesRouter from "./routes/categories.js";
import chainsRouter from "./routes/chains.js";
import ingestRouter from "./routes/ingest.js";
import statsRouter from "./routes/stats.js";
import dietClassificationRouter from "./routes/dietClassification.js";

const PORT = Number(process.env.PORT ?? 4000);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "0 */6 * * *";
const INGEST_ON_STARTUP = process.env.INGEST_ON_STARTUP !== "false";

async function main() {
  await runMigrations();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", productsRouter);
  app.use("/api", productDetailRouter);
  app.use("/api", categoriesRouter);
  app.use("/api", chainsRouter);
  app.use("/api", ingestRouter);
  app.use("/api", statsRouter);
  app.use("/api", dietClassificationRouter);

  app.listen(PORT, () => {
    console.log(`[server] listening on port ${PORT}`);
  });

  startScheduler(CRON_SCHEDULE);
  startNutritionCrawler();

  if (INGEST_ON_STARTUP) {
    console.log("[server] running initial ingest on startup");
    runAllChains().catch((err) => console.error("[server] initial ingest failed:", err));
  }
}

main().catch((err) => {
  console.error("[server] fatal error during startup:", err);
  process.exit(1);
});
