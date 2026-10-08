import { runReguaFromSienge } from "../lib/collection/regua";
import { db } from "../lib/db";

// Executado pelo Railway Cron (npm run cron:collection). Roda a régua e encerra.
// Sem top-level await: o tsx compila para CJS no Railway e rejeita.
async function main() {
  try {
    console.log(JSON.stringify(await runReguaFromSienge(new Date())));
  } finally {
    await db.$disconnect();
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
