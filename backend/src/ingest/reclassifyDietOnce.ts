import "dotenv/config";
import { pool } from "../db/pool.js";
import { reclassifyAllDiet } from "./reclassifyDiet.js";

async function main() {
  const summary = await reclassifyAllDiet();
  console.log(summary);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
