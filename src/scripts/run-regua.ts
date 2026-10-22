import { runRegua } from "../lib/regua/executar";
import { db } from "../lib/db";

// Railway Cron (npm run cron:regua) — 08:30 Maceió. Sem top-level await (tsx/CJS).
async function main() {
  try {
    const r = await runRegua();
    console.log(JSON.stringify({ ...r, pulados: r.pulados.length }));
  } finally {
    await db.$disconnect();
  }
}
const sair = (code: number) => process.stdout.write("", () => process.exit(code));
main().then(() => sair(0), (err) => { console.error(err); sair(1); });
