import { runConfirmacoesPagamento } from "../lib/payments/confirmacao";
import { db } from "../lib/db";

// Executado pelo Railway Cron (npm run cron:payment-confirmations) à tarde.
// Sem top-level await: o tsx compila para CJS no Railway e rejeita.
async function main() {
  try {
    console.log(JSON.stringify(await runConfirmacoesPagamento()));
  } finally {
    await db.$disconnect();
  }
}

// Sai só depois de o stdout esvaziar: process.exit() imediato perde a última
// linha do log quando a saída é um pipe (caso do Railway).
const sair = (code: number) => process.stdout.write("", () => process.exit(code));
main().then(() => sair(0), (err) => { console.error(err); sair(1); });
