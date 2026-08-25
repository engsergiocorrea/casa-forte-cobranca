import { z } from "zod";

const bool = z.string().default("false").transform(v => v.toLowerCase() === "true");
const schema = z.object({
  APP_MODE: z.enum(["staging", "production"]).default("staging"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TIMEZONE: z.string().default("America/Maceio"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OUTBOUND_MESSAGING_ENABLED: bool,
  WHATSAPP_DRY_RUN: bool,
  WHATSAPP_ALLOW_ALL_PRODUCTION: bool,
  WHATSAPP_ALLOWLIST: z.string().default(""),
  SIENGE_SUBDOMAIN: z.string().min(1),
  SIENGE_USERNAME: z.string().min(1),
  SIENGE_PASSWORD: z.string().min(1),
  SIENGE_WEBHOOK_TOKEN: z.string().min(16),
  // Escrita no Sienge (cadastro de cliente). Trava própria: só grava de verdade
  // com SIENGE_WRITE_DRY_RUN=false. typeId = "Tipo de Cliente" do Sienge;
  // personType = valor aceito para pessoa física (ex.: definido pela API).
  SIENGE_WRITE_DRY_RUN: z.string().default("true").transform((v) => v.toLowerCase() !== "false"),
  SIENGE_CUSTOMER_TYPE_ID: z.string().default(""),
  // Subtipo de cliente (opcional) — ex.: "CASA FORTE" (código 1).
  SIENGE_CUSTOMER_SUBTYPE_ID: z.string().default(""),
  // "F" = pessoa física (confirmado na Model do POST /customers do Sienge).
  SIENGE_PERSON_TYPE_FISICA: z.string().default("F"),
  // Gênero (obrigatório no Sienge; contrato não traz) e correspondência —
  // códigos reais confirmados pela detecção (action=amostra-cliente).
  SIENGE_DEFAULT_SEX: z.string().default(""),
  SIENGE_DEFAULT_MAILING: z.string().default(""),
  META_GRAPH_API_VERSION: z.string().min(2),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_WABA_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_APP_SECRET: z.string().default(""),
  // Canal de envio: "evolution" (WhatsApp não-oficial, mesma do portal/compras —
  // sem template) ou "meta" (Cloud API oficial, exige template aprovado).
  WHATSAPP_PROVIDER: z.enum(["evolution", "meta"]).default("evolution"),
  EVOLUTION_API_URL: z.string().default(""),
  EVOLUTION_API_KEY: z.string().default(""),
  EVOLUTION_INSTANCE: z.string().default("casaforte"),
  CRON_SECRET: z.string().min(16).default("CHANGE_ME_CHANGE_ME"),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
