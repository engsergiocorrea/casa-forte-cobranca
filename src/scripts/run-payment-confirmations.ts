import { runConfirmacoesPagamento } from "../lib/payments/confirmacao";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { localDateKey, localHour } from "../lib/collection/date";
import { enviarRelatorioDia } from "../lib/relatorio/enviar";
import { verificarELiberar } from "../lib/comissoes/servico";

// Executado pelo Railway Cron (npm run cron:payment-confirmations) à tarde.
// Sem top-level await: o tsx compila para CJS no Railway e rejeita.
async function main() {
  try {
    console.log(JSON.stringify(await runConfirmacoesPagamento()));
    // Comissões: libera as que tiveram o sinal quitado (REST do Sienge, não usa
    // o limite do bulk-data). Falha aqui não derruba a confirmação de pagamento.
    try { console.log(JSON.stringify({ comissoes: await verificarELiberar({ solicitadoPor: "cron" }) })); }
    catch (err) { console.error("comissoes:", err); }
    // Relatório do dia: depois da última execução (18h), se ligado.
    const e = env();
    if (e.REPORT_AUTO_ENABLED && localHour(new Date(), e.TIMEZONE) >= 17) {
      console.log(JSON.stringify({ relatorio: await enviarRelatorioDia(localDateKey(new Date(), e.TIMEZONE), "auto") }));
    }
  } finally {
    await db.$disconnect();
  }
}

// Sai só depois de o stdout esvaziar: process.exit() imediato perde a última
// linha do log quando a saída é um pipe (caso do Railway).
const sair = (code: number) => process.stdout.write("", () => process.exit(code));
main().then(() => sair(0), (err) => { console.error(err); sair(1); });
