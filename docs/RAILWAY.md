# Railway staging

## Recursos
- PostgreSQL
- Redis
- Serviço `web`
- Serviço `worker`
- Serviço `cron-collection`

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

## Migration
Em deploy controlado:
`npm run db:migrate:deploy`

## Staging
Use banco, Redis, credenciais Meta e webhook URLs separados de produção sempre que possível. Não copie `WHATSAPP_ALLOW_ALL_PRODUCTION=true` para staging.
