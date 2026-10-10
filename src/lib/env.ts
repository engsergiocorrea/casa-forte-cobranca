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
  // Confirmação de pagamento (bank-movement → WhatsApp). Trava própria, além
  // das travas-mestras: só envia com PAYMENT_CONFIRMATION_ENABLED=true.
  // START_DATE = corte: movimentos ANTERIORES nunca são confirmados (backlog).
  // MIN_HOUR = só roda à tarde (a baixa do retorno bancário é feita até 12h).
  PAYMENT_CONFIRMATION_ENABLED: bool,
  PAYMENT_CONFIRMATION_START_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-10-07"),
  PAYMENT_CONFIRMATION_MIN_HOUR: z.coerce.number().int().min(0).max(23).default(13),
  // Anexa o "Comprovante de pagamento" em PDF (gerado por nós) à confirmação.
  // false = só texto (comportamento original).
  PAYMENT_CONFIRMATION_PDF_ENABLED: bool,
  // Linha jurídica opcional no rodapé do comprovante (razão social/CNPJ). Vazia = omite.
  COMPANY_LEGAL_LINE: z.string().default(""),
  PAYMENT_CONFIRMATION_LOOKBACK_DAYS: z.coerce.number().int().min(0).max(10).default(3),
  CRON_SECRET: z.string().min(16).default("CHANGE_ME_CHANGE_ME"),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
