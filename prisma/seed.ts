import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Régua definida pela Casa Forte:
  //  - D-10: aviso 10 dias antes do vencimento (envia o boleto)
  //  - D0:   no dia do vencimento
  //  - D+1:  1 dia após o vencimento, se a parcela seguir em aberto (inadimplência)
  // Todas começam DESABILITADAS (enabled=false) — nenhuma cobrança sai
  // automaticamente até habilitação + liberação das travas de envio.
  const rules = [
    { name: "D-10", dayOffset: -10, templateName: process.env.WA_TEMPLATE_D_MINUS_10 || "cf_cobranca_d_menos_10" },
    { name: "D0", dayOffset: 0, templateName: process.env.WA_TEMPLATE_DUE_TODAY || "cf_cobranca_vence_hoje" },
    { name: "D+1", dayOffset: 1, templateName: process.env.WA_TEMPLATE_D_PLUS_1 || "cf_cobranca_atraso_1d" },
  ];
  // Remove regras antigas do starter que não fazem parte desta régua.
  await prisma.collectionRule.deleteMany({ where: { name: { in: ["D-3", "D+3", "D+7"] } } });
  for (const rule of rules) {
    await prisma.collectionRule.upsert({
      where: { name: rule.name },
      update: { ...rule, enabled: false },
      create: { ...rule, enabled: false, languageCode: process.env.WA_TEMPLATE_LANGUAGE || "pt_BR", sendHour: 9 },
    });
  }
  console.log("Seed concluído. Régua D-10 / D0 / D+1 — todas DESABILITADAS.");
}
main().finally(() => prisma.$disconnect());
