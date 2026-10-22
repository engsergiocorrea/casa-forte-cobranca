# Railway staging

## Recursos
- PostgreSQL
- Redis
- Serviço `web`
- Serviço `worker`
- Serviço `cron-collection`
- Serviço `cron-payment-confirmations`
- Serviço `cron-regua` (régua v2: boleto D-10, lembrete D0, cobrança D+1/7/15)

## Web
Build: `npm run build`
Start: `npm run start`
Health: `/api/health`

## Worker
Start: `npm run worker`
Sem domínio público.

## Cron
Start: `npm run cron:collection`
Configurar inicialmente 1 execução diária antes do horário da régua; posteriormente podemos rodar mais vezes sem duplicar graças a `dedupeKey`.

## Cron — confirmação de pagamento
Start: `npm run cron:payment-confirmations`
Schedule (UTC): `0 15,21 * * *` = 12h e 18h em Maceió, todos os dias. Cada pagamento é confirmado UMA vez (registro único por parcela); a 2ª execução só pega baixas novas. O financeiro dá a baixa do retorno bancário até 12h; o job recusa rodar antes de `PAYMENT_CONFIRMATION_MIN_HOUR` (13h).
Cada execução gasta 1 das **20 requisições/dia** do bulk-data do Sienge (`/public/api/bulk-data/v1/bank-movement`) — não rodar mais que poucas vezes ao dia.
Variáveis: `PAYMENT_CONFIRMATION_ENABLED` (false = não roda), `PAYMENT_CONFIRMATION_START_DATE` (corte; nada pago antes é confirmado), `PAYMENT_CONFIRMATION_LOOKBACK_DAYS` (3), `PAYMENT_CONFIRMATION_MIN_HOUR` (13). O envio passa por `canSendTo` (master switch + dry-run + allowlist), igual à régua automática.
Prévia sem gravar/enviar: `POST /api/internal/payment-confirmations?preview=1` com `Authorization: Bearer $CRON_SECRET`.

## Cron — régua v2 (boleto / lembrete / cobrança)
Serviço `cron-regua`, mesmo repo/branch, configurado igual ao `cron-payment-confirmations`:
- Build: `npx prisma generate` · Start: `npm run cron:regua` · Restart Policy: Never · sem domínio
- Schedule (UTC): `30 11 * * *` = 08:30 em Maceió, todos os dias
- Variables: as mesmas referências do cron de confirmação (`${{casa-forte-cobranca.X}}`, `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`) +
  `BOLETO_ENABLED`, `LEMBRETE_ENABLED`, `COBRANCA_ENABLED` (padrão false), `REGUA_DRY_RUN=true` (só registra; não envia),
  `BOLETO_DIAS_ANTES=10`, `COBRANCA_ETAPAS=1,7,15`, `COBRANCA_TOLERANCIA_DIAS=3`.
- Prévia (não grava/envia): `POST /api/internal/regua?preview=1` · Registros: `GET /api/internal/regua?billId=N` (Bearer CRON_SECRET).
- 1 chamada bulk-data por execução (limite 20/dia).

## Migration
Em deploy controlado:
`npm run db:migrate:deploy`

## Staging
Use banco, Redis, credenciais Meta e webhook URLs separados de produção sempre que possível. Não copie `WHATSAPP_ALLOW_ALL_PRODUCTION=true` para staging.
