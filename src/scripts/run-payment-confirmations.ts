import { runConfirmacoesPagamento } from "../lib/payments/confirmacao";
import { db } from "../lib/db";

// Executado pelo Railway Cron (npm run cron:payment-confirmations) à tarde.
try {
  console.log(JSON.stringify(await runConfirmacoesPagamento()));
} finally {
  await db.$disconnect();
}
