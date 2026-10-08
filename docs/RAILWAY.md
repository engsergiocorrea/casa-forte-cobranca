# Railway staging

## Recursos
- PostgreSQL
- Redis
- Serviço `web`
- Serviço `worker`
- Serviço `cron-collection`
- Serviço `cron-payment-confirmations`

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
Schedule (UTC): `30 17,20 * * 1-5` = 14h30 e 17h30 em Maceió, seg–sex. O financeiro dá a baixa do retorno bancário até 12h; o job recusa rodar antes de `PAYMENT_CONFIRMATION_MIN_HOUR` (13h).
Cada execução gasta 1 das **20 requisições/dia** do bulk-data do Sienge (`/public/api/bulk-data/v1/bank-movement`) — não rodar mais que poucas vezes ao dia.
Variáveis: `PAYMENT_CONFIRMATION_ENABLED` (false = não roda), `PAYMENT_CONFIRMATION_START_DATE` (corte; nada pago antes é confirmado), `PAYMENT_CONFIRMATION_LOOKBACK_DAYS` (3), `PAYMENT_CONFIRMATION_MIN_HOUR` (13). O envio passa por `canSendTo` (master switch + dry-run + allowlist), igual à régua automática.
Prévia sem gravar/enviar: `POST /api/internal/payment-confirmations?preview=1` com `Authorization: Bearer $CRON_SECRET`.

## Migration
Em deploy controlado:
`npm run db:migrate:deploy`

## Staging
Use banco, Redis, credenciais Meta e webhook URLs separados de produção sempre que possível. Não copie `WHATSAPP_ALLOW_ALL_PRODUCTION=true` para staging.
