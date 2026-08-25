import { runReguaFromSienge } from "../lib/collection/regua";
import { db } from "../lib/db";

// Executado pelo Railway Cron (npm run cron:collection). Roda a régua e encerra.
try {
  console.log(JSON.stringify(await runReguaFromSienge(new Date())));
} finally {
  await db.$disconnect();
}
