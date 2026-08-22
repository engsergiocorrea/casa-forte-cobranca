# Casa Forte Cobrança — Starter v0.1

MVP seguro para substituir a camada de WhatsApp do Nano mantendo o **Sienge como fonte financeira oficial**.

## Princípios

- Sienge calcula/baixa/emite; Casa Forte comunica.
- WhatsApp é o primeiro canal. E-mail continua no Sienge nesta fase.
- Nenhum envio real por padrão.
- Revalidação no Sienge imediatamente antes de uma cobrança.
- Baixa parcial cancela automação e exige revisão humana.
- Webhooks entram rápido, são persistidos/idempotentes e processados no worker.

## Serviços Railway

Crie 4 serviços a partir do mesmo repositório:

1. **web** — build `npm run build`; start `npm run start`
2. **worker** — start `npm run worker`
3. **cron-collection** — cron diário; start `npm run cron:collection`
4. PostgreSQL + Redis gerenciados pelo Railway

Antes do web/worker: `npm run db:migrate:deploy`.

## Primeiro boot local

```bash
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run db:seed
npm test
npm run dev
```

Em outro terminal: `npm run worker`.

## Segurança inicial obrigatória

Mantenha:

```env
APP_MODE=staging
OUTBOUND_MESSAGING_ENABLED=false
WHATSAPP_DRY_RUN=true
WHATSAPP_ALLOW_ALL_PRODUCTION=false
```

Depois de validar dry-run, para testar UM telefone:

```env
OUTBOUND_MESSAGING_ENABLED=true
WHATSAPP_DRY_RUN=false
WHATSAPP_ALLOWLIST=+55SEUNUMERO
```

Nunca altere `WHATSAPP_ALLOW_ALL_PRODUCTION=true` antes do aceite formal dos testes.

## Webhooks

Sienge:
`POST https://SEU_DOMINIO/api/webhooks/sienge?token=SEU_TOKEN_LONGO`

WhatsApp:
`GET/POST https://SEU_DOMINIO/api/webhooks/whatsapp`

## Importante sobre o mapper Sienge

A rota oficial de título é `/accounts-receivable/receivable-bills/{receivableBillId}` e o webhook informa `receivableBillId` + `installmentId`. A estrutura exata da resposta deve ser confirmada com um payload REAL e redigido na base Casa Forte antes de ativar cobrança. O arquivo `src/lib/sienge/mapper.ts` foi feito defensivo para o primeiro teste, não para ser tratado como contrato final.

Leia `CLAUDE.md` e `docs/TEST-PLAN.md` antes de continuar.
