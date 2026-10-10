import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { runAllChains, getIngestStatus } from "../ingest/runAll.js";
import { getNutritionCrawlStatus } from "../ingest/nutritionCrawler.js";

const router = Router();

router.get("/ingest/status", (_req, res) => {
  res.json(getIngestStatus());
});

router.get("/nutrition-crawl/status", async (_req, res) => {
  res.json(await getNutritionCrawlStatus());
});

router.post("/ingest/run", requireAdmin, (_req, res) => {
  const status = getIngestStatus();
  if (status.running) {
    res.status(409).json({ error: "Ingest already in progress" });
    return;
  }

  runAllChains().catch((err) => console.error("[ingest] manual run failed:", err));
  res.status(202).json({ message: "Ingest started" });
});

export default router;
