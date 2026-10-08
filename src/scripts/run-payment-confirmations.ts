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

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
