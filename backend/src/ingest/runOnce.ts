import "dotenv/config";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { runAllChains } from "./runAll.js";

async function main() {
  await runMigrations();
  const summaries = await runAllChains();
  console.table(summaries);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
