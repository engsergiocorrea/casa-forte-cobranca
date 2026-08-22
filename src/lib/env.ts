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
  META_GRAPH_API_VERSION: z.string().min(2),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_WABA_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_APP_SECRET: z.string().default(""),
  CRON_SECRET: z.string().min(16).default("CHANGE_ME_CHANGE_ME"),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
