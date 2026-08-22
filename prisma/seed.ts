import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rules = [
    { name: "D-3", dayOffset: -3, templateName: process.env.WA_TEMPLATE_D_MINUS_3 || "cf_cobranca_d_menos_3" },
    { name: "D0", dayOffset: 0, templateName: process.env.WA_TEMPLATE_DUE_TODAY || "cf_cobranca_vence_hoje" },
    { name: "D+3", dayOffset: 3, templateName: process.env.WA_TEMPLATE_D_PLUS_3 || "cf_cobranca_d_mais_3" },
    { name: "D+7", dayOffset: 7, templateName: process.env.WA_TEMPLATE_D_PLUS_7 || "cf_cobranca_d_mais_7" }
  ];
  for (const rule of rules) {
    await prisma.collectionRule.upsert({
      where: { name: rule.name },
      update: { ...rule, enabled: false },
      create: { ...rule, enabled: false, languageCode: process.env.WA_TEMPLATE_LANGUAGE || "pt_BR", sendHour: 9 }
    });
  }
  console.log("Seed concluído. Todas as regras começam DESABILITADAS.");
}
main().finally(() => prisma.$disconnect());
