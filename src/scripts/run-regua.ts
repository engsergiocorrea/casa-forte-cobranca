import { runRegua } from "../lib/regua/executar";
import { db } from "../lib/db";
import { sincronizarHistorico } from "../lib/painel/historico";

// Railway Cron (npm run cron:regua) — 08:30 Maceió. Sem top-level await (tsx/CJS).
async function main() {
  try {
    const r = await runRegua();
    console.log(JSON.stringify({ ...r, pulados: r.pulados.length }));
    // Histórico de pagamentos de todos os contratos (1 chamada bulk por lote de 40 títulos).
    try { console.log(JSON.stringify({ historico: await sincronizarHistorico() })); }
    catch (err) { console.error("historico", (err as Error)?.message); }
  } finally {
    await db.$disconnect();
  }
}
const sair = (code: number) => process.stdout.write("", () => process.exit(code));
main().then(() => sair(0), (err) => { console.error(err); sair(1); });
