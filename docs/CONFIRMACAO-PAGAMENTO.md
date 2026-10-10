# Confirmação automática de pagamento (Sienge → WhatsApp)

Contexto para qualquer sessão/assistente que for mexer nesta funcionalidade.
No ar desde **08/10/2026**. Última revisão: 10/10/2026.

## O que faz

Todo dia às **18h (America/Maceio)** um job lê no Sienge os pagamentos de
clientes que o financeiro baixou e manda pelo WhatsApp (Evolution) uma
confirmação ao cliente. Uma mensagem por cliente, listando as parcelas pagas.

Rotina do financeiro: o arquivo de retorno do banco chega no dia seguinte ao
pagamento; a baixa no Sienge é feita de manhã, até ~12h. Por isso o job roda
no fim da tarde.

## Regras de negócio (pedidas pelo usuário — não afrouxar)

1. **Corte:** nada pago antes de `PAYMENT_CONFIRMATION_START_DATE=2026-10-07`
   é confirmado (backlog nunca recebe mensagem).
2. **Uma única confirmação por parcela, para sempre.** Tabela
   `PaymentConfirmation` com UNIQUE (`billId`, `installmentId`).
3. **Só pagamento de verdade**, nunca baixa por inadimplência, cancelamento,
   renegociação ou abatimento (ver "Como sabemos que é pagamento").
4. Não calcular nada financeiro localmente: o Sienge é a fonte da verdade.

## Fluxo

```
Railway cron (21:00 UTC = 18h Maceió, todo dia)
  → npm run cron:payment-confirmations  (src/scripts/run-payment-confirmations.ts)
  → runConfirmacoesPagamento()          (src/lib/payments/confirmacao.ts)
      1. GET bulk-data /bank-movement (janela: últimos 3 dias, nunca antes do corte)
      2. selecionarRecebimentos()        (src/lib/payments/selecao.ts — pura, testada)
      3. tira parcelas já SENT/SENDING/UNCERTAIN
      4. revalida no Sienge: parcela com balanceDue = 0 e título do mesmo cliente
      5. telefone do cadastro do cliente (GET /customers/{id})
      6. "reivindica" a parcela no banco (status SENDING) ANTES de enviar
      7. canSendTo (master switch + dry-run + allowlist/produção)
      8. Evolution sendText → SENT | ERROR | UNCERTAIN
```

## Sienge — o que descobrimos (validado com dados reais em 08/10/2026)

- **Movimentos de caixa/banco ficam na API bulk-data**, não na v1:
  `GET https://api.sienge.com.br/{subdominio}/public/api/bulk-data/v1/bank-movement?startDate=yyyy-MM-dd&endDate=yyyy-MM-dd&selectionType=M`
  Em `/public/api/v1/bank-movement` o Sienge responde **404 em HTML**.
- **Limite do bulk-data: 20 requisições por DIA** (header
  `x-ratelimit-limit-day`). Cada execução do job e cada prévia gasta 1.
  Não usar em polling.
- Sem paginação: devolve tudo de uma vez em `{ data: [...] }`.
- Specs oficiais (públicas): `https://api.sienge.com.br/docs/yaml-files/<nome>.yaml`
  (ex.: `bulk-data-bank-movement-v1`, `bulk-data-income-v1`, `hooks-v1`).
- Campos usados de cada movimento: `bankMovementId`, `billId`,
  `installmentId`, `bankMovementAmount`, `bankMovementOriginId`,
  `bankMovementHistoricId`, `bankMovementOperationId`,
  `bankMovementOperationType`, `bankMovementDate`,
  `documentIdentificationNumber` (nº do contrato, ex. `UMAR-05`), `clientId`,
  `clientName`.
- Códigos observados:
  | Campo | Valor | Significado |
  |---|---|---|
  | origem | `CR` | Contas a Receber |
  | operação | `1` / tipo `E` | Recebimento (entrada) |
  | operação | `2` / tipo `S` | Pagamento (saída) |
  | histórico | `14` | Recebimento (principal) |
  | histórico | `19` | Recebimento acréscimo (juros/multa) |
  | histórico | `20` | Desconto concedido (vem como saída) |
- `bankMovementId` é único; **uma parcela pode ter vários movimentos**
  (principal + acréscimo + desconto, ou pagamento em duas vezes). A chave do
  cliente é título + parcela.
- `billDate` do movimento é a **competência**, não o vencimento. O vencimento
  certo vem de `GET /accounts-receivable/receivable-bills/{billId}/installments`
  (`dueDate`, `balanceDue`; `balanceDue = 0` = quitada).
- O Sienge **não informa se foi boleto, PIX ou TED**. Todo recebimento real
  é confirmado.
- `conditionTypeId` das parcelas (observado, não documentado): `PM` mensal,
  `PS` semestral/balão, `SI` sinal, `CH` chaves. Uma mesma data pode ter duas
  parcelas (mensal + semestral).
- Existe webhook `RECEIPT_PROCESSED` {billId, installmentId} para baixas de
  recebimento; o worker já o recebe (só sincroniza), mas a confirmação usa o
  bank-movement por ser prova de dinheiro entrando.

## Como sabemos que é pagamento (e não baixa por inadimplência etc.)

Só existe movimento de caixa/banco quando **dinheiro entrou numa conta**.
Baixas sem dinheiro não geram movimento. Regras em `selecao.ts`:

- só origem `CR` com título + parcela + cliente;
- exige um movimento **principal** (operação 1, tipo E, histórico 14, valor > 0);
- aceita como acessórios só histórico 19 (E) e 20 (S); **qualquer outro código
  descarta a parcela inteira** (`MOVIMENTO_NAO_RECONHECIDO`) para revisão;
- valor líquido (entradas − saídas) > 0;
- todos os movimentos da parcela do mesmo cliente;
- na hora do envio, a parcela precisa estar com **saldo 0** no Sienge (barra
  pagamento parcial e estorno feito depois) e o título precisa ser do mesmo
  `customerId`.

## Anti-duplicidade

- Antes de enviar, a parcela é gravada como `SENDING` (insert; se já existir,
  `updateMany` atômico só a partir de status retentável). Dois runs ao mesmo
  tempo não pegam a mesma parcela.
- Status que **bloqueiam para sempre**: `SENT`, `SENDING`, `UNCERTAIN`.
- Status que **tentam de novo** na próxima execução (até 5 tentativas):
  `DRY_RUN`, `BLOCKED`, `NO_PHONE`, `ERROR`.
- `UNCERTAIN` = falha de conexão/timeout com a Evolution (a mensagem pode ter
  saído). Não reenvia sozinho: conferir no WhatsApp e ajustar o registro à mão.
- Verificado em 08/10: depois do envio, a prévia mostrou `jaConfirmados: 3`
  e `previews: []`.

## Mensagem (src/lib/collection/messages.ts → `previewConfirmacao`)

Tom formal, sem "Oi" nem agradecimento (pedido de 10/10/2026):

```
✅ Pagamento recebido

{Primeiro nome}, confirmamos o recebimento do seu pagamento:

🏠 {empreendimento — unidade}
📅 Parcela com vencimento em {dd/mm/aaaa}
💰 {R$ valor líquido} — pago em {dd/mm/aaaa}

🤖 Esta é uma confirmação automática da Casa Forte. Em caso de dúvida, basta responder esta mensagem.

#aquiécasaforte
```

Plural: "✅ Pagamentos recebidos" / "dos seus pagamentos", um bloco por parcela.
O primeiro nome vem do Sienge em CAIXA ALTA e é convertido para "Alysson".
O nome do imóvel sai como está no Sienge (`UMÁ MILAGRES — R - 05`).

## Configuração

### Variáveis do job (serviço `cron-payment-confirmations`)

| Variável | Valor | Função |
|---|---|---|
| `PAYMENT_CONFIRMATION_ENABLED` | `true` | trava própria (false = não roda) |
| `PAYMENT_CONFIRMATION_START_DATE` | `2026-10-07` | corte do backlog |
| `PAYMENT_CONFIRMATION_LOOKBACK_DAYS` | `3` | janela de busca |
| `PAYMENT_CONFIRMATION_MIN_HOUR` | `12` | recusa rodar antes dessa hora (ignorado com `?force=1`) |

As demais (banco, Redis, Sienge, Evolution, travas de WhatsApp) são
**referências** ao serviço web, ex.: `SIENGE_USERNAME=${{casa-forte-cobranca.SIENGE_USERNAME}}`,
`DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`.
Nenhuma pode ficar com valor vazio (número vazio vira 0).

### Travas de envio (serviço web `casa-forte-cobranca`)

Em 08/10/2026 o usuário **liberou para todos os clientes**:
`APP_MODE=production`, `WHATSAPP_ALLOW_ALL_PRODUCTION=true`,
`OUTBOUND_MESSAGING_ENABLED=true`, `WHATSAPP_DRY_RUN=false`.
Hoje só a confirmação de pagamento envia sozinha. A régua de cobrança
(D-10/D0/D+1) continua com as etapas desligadas; se alguém ligar uma etapa,
ela dispara para a base inteira. O agendador antigo `scheduleCollectionRun`
não é chamado em lugar nenhum.

### Railway (projeto `pacific-reprieve`, ambiente `production`)

Serviço `cron-payment-confirmations`, mesmo repo/branch `main`:
- Build: `npx prisma generate` (não usar `npm run build`: o `next build`
  quebra sem as variáveis e o cron não precisa do site).
- Start: `npm run cron:payment-confirmations`
- Cron Schedule: `0 21 * * *` (18h Maceió, todos os dias)
- Restart Policy: **Never**
- Sem domínio público. Entre execuções aparece como parado: é normal.
- Migração da tabela roda no start do serviço web (`prisma migrate deploy`).

## Operação

- **Resultado de cada execução:** Cron Runs → abrir a execução → Deploy Logs.
  O Railway mostra o JSON como campos: `janela`, `movimentos`, `recebimentos`,
  `jaConfirmados`, `clientes`, `enviados`, `dryRun`, `bloqueados`,
  `semTelefone`, `erros`, `incertos`, `pulados[]`, `skipped`.
  - `skipped: ANTES_DO_HORARIO` → rodou antes de `MIN_HOUR`.
  - `skipped: PAYMENT_CONFIRMATION_ENABLED=false` → job desligado.
  - `bloqueados` → travas de WhatsApp fechadas para aquele número.
  - `erros` → Evolution recusou (geralmente instância desconectada).
- **Prévia sem gravar nem enviar** (gasta 1 das 20 consultas/dia):
  ```bash
  curl -s -X POST -H "Authorization: Bearer $(pbpaste)" "https://cobranca.casaforteinc.com.br/api/internal/payment-confirmations?preview=1"
  ```
  (copiar o `CRON_SECRET` do serviço web antes; `pbpaste` evita expor o segredo.)
  `?force=1` executa ignorando só o horário mínimo.
- **Evolution cai sozinha** (instância `casaforte`, WhatsApp via QR). Conferir:
  `GET {EVOLUTION_API_URL}/instance/connectionState/casaforte` com header
  `apikey` → `state: "open"`. Reconectar no Evolution Manager.
- Rodar local: `.env` com as credenciais (gitignored). `npm test` (46 testes).

## Armadilhas já encontradas

- `tsx` compila para CJS no Railway: **sem top-level await** nos scripts
  (corrigido também em `run-collection.ts`, que tinha o mesmo defeito).
- Scripts saem com `process.stdout.write("", cb)` antes do `process.exit`,
  para não perder a última linha do log.
- Os comandos `read -s` não funcionam no campo `!` do chat do Claude Code
  (não é interativo); usar `$(pbpaste)`.

## Histórico (commits em `main`)

- `6bf7a99` confirmação automática de pagamento (bank-movement → WhatsApp)
- `200a0ec` remove top-level await dos scripts de cron
- `5c51ed1` primeiro nome com inicial maiúscula
- `55321fa` espera o stdout esvaziar antes de sair
- `6e34d4e` / `fadbca1` mensagem informal com emojis, 🧡 e #aquiécasaforte
- `e690113` doc: cron 1x/dia às 18h
- `3d27473` mensagem formal, sem "Oi" nem agradecimento

Primeiro envio real: 08/10/2026, 2 clientes (3 parcelas), sem duplicidade.

## Pendências

- **Trocar o `CRON_SECRET`** do serviço web (ficou exposto em terminal em
  08/10). Gerar com `openssl rand -hex 32`; o cron não usa esse segredo.
- Confirmar se alguém acompanha as respostas no número da instância
  `casaforte` (a mensagem diz "basta responder esta mensagem").
- Opcional: formatar o nome do imóvel ("Umá Milagres – R-05").
- Opcional: usar `RECEIPT_PROCESSED` como gatilho/conferência extra.
