# Arquitetura — Comunicação financeira Casa Forte (v2)

Desenho de 21/10/2026. Substitui a régua antiga (`src/lib/collection/regua.ts`)
e unifica com a confirmação de pagamento, que já está no ar
(`docs/CONFIRMACAO-PAGAMENTO.md`). Serve de referência para este repositório e
para o **Casa Forte Brain** (outro projeto), que vai comandar este sistema.

## 1. O que o sistema faz

| # | Comunicação | Quando | Para quem |
|---|---|---|---|
| 1 | **Boleto do mês** (texto + PDF do boleto) | D-10 do vencimento; se o boleto ainda não existir (INCC-DI atrasado), na 1ª execução em que aparecer, até D0 | cliente |
| 2 | **Lembrete de vencimento** (texto + linha digitável/boleto) | D0, se a parcela ainda estiver em aberto | cliente |
| 3 | **Confirmação de pagamento** (texto + recibo PDF) | 12h e 18h, após a baixa no Sienge (já no ar) | cliente |
| 4 | **Cobrança de inadimplência** (texto + boleto atualizado) | D+1, D+7 e D+15, se ainda em aberto. Depois de D+15, o caso fica no painel para o financeiro | cliente |
| 5 | **Relatório do dia** (PDF) | No dia em que houver envio de boletos **ou** qualquer falha | Sergio (diretor) e Bruna (gerente financeira), por WhatsApp |
| 6 | **Comandos sob demanda** (boleto, extrato/relatório do cliente, termo de quitação, reenvio) | Quando pedido no painel ou pelo Casa Forte Brain | cliente ou diretoria |

Decisões do usuário (21/10/2026): inadimplência em D+1/D+7/D+15; boleto atrasado
sai assim que gerado; relatório por WhatsApp; **uma mensagem por pagamento**
na confirmação.

## 2. Princípios (não negociáveis)

1. **Sienge é a fonte da verdade financeira.** Nada de calcular saldo, juros ou
   multa. Toda mensagem é revalidada no Sienge imediatamente antes do envio
   (boleto/cobrança só com saldo > 0; confirmação só com saldo = 0).
2. **Cada comunicação sai no máximo uma vez.** Um registro único por
   comunicação (`dedupeKey`), reivindicado no banco **antes** do envio. Timeout
   no envio = `UNCERTAIN`, nunca reenvia sozinho.
3. **Canal trocável.** Nenhuma regra de negócio conhece Evolution ou Meta. Trocar
   de canal = mudar `WHATSAPP_PROVIDER` e cadastrar os templates na Meta.
4. **Travas de segurança mantidas**: `OUTBOUND_MESSAGING_ENABLED`,
   `WHATSAPP_DRY_RUN`, allowlist/`WHATSAPP_ALLOW_ALL_PRODUCTION`, e uma trava
   por tipo de comunicação (ex.: `COBRANCA_ENABLED`).
5. **Tudo auditável**: quem pediu (cron, painel, Brain/Sergio, Brain/Bruna),
   o quê, quando, para quem, resultado do canal.
6. **Econômico com o Sienge**: bulk-data tem limite de **20 chamadas/dia**.
   O desenho usa no máximo ~6/dia.

## 3. Visão geral

```
                 ┌──────────────── Railway (projeto pacific-reprieve) ────────────────┐
 Sienge ──bulk──▶│  JOBS (cron)                                                       │
 (income,        │   08:30 planejar+enviar  boletos D-10 / lembrete D0 / cobrança D+N  │
  bank-movement, │   12:00 e 18:00 confirmação de pagamento (já existe)               │
  REST boleto,   │   após cada job: relatório do dia (se houve boleto ou falha)       │
  clientes)      │                                                                    │
                 │  NÚCLEO                                                            │
                 │   planejador → Comunicacao (outbox, dedupe) → revalidação Sienge   │
                 │   → travas → Canal (interface) → status/entrega                    │
                 │                                                                    │
                 │  CANAL  ┌ EvolutionChannel (hoje: texto livre + PDF base64)        │
                 │         └ MetaChannel (em breve: templates + mídia via upload)     │
                 │                                                                    │
                 │  PAINEL /painel (Basic Auth → login depois)                        │
                 │  API    /api/brain/* (token do Brain + ator: sergio|bruna)         │
                 │  WEBHOOKS  status de entrega (Evolution/Meta) e Sienge             │
                 └────────────────────────────────────────────────────────────────────┘
                              ▲
              Casa Forte Brain (outro projeto) — "envie o boleto de fulano"
```

## 4. Componentes

### 4.1 Leitura do Sienge (eficiente)

| Dado | Endpoint | Chamadas/dia |
|---|---|---|
| Parcelas que vencem em [hoje−15, hoje+10] (abertas e pagas), com `installmentNumber`, `mainUnit`, cliente, saldo | bulk `GET /income?selectionType=D&startDate&endDate` | 1 (job 08:30) |
| Pagamentos (confirmação) | bulk `GET /bank-movement` (já existe) | 2 (12h, 18h) |
| Dados do recibo | bulk `GET /income/by-bills` (já existe) | até 2 |
| Saldo na hora do envio (revalidação) | REST `/receivable-bills/{id}/installments` | por título, só dos que vão sair |
| Boleto (link + linha digitável) | REST `/payment-slip-notification` | por parcela que vai sair |
| Telefone | REST `/customers/{id}` | por cliente que vai receber |

A régua antiga varria **todos** os contratos e **todas** as parcelas via REST
a cada execução; a nova faz 1 chamada bulk e só consulta REST o que vai sair.

### 4.2 Comunicacao (outbox único)

Nova tabela que substitui `CollectionSend` e `PaymentConfirmation` (os dados
atuais são migrados) e aposenta `Message`/`MessageEvent`/`scheduler.ts`
(pipeline antigo da Meta que não é usado).

```
Comunicacao
  id, tipo            BOLETO | LEMBRETE_D0 | COBRANCA | CONFIRMACAO
                      | BOLETO_AVULSO | RELATORIO_CLIENTE | TERMO_QUITACAO | RELATORIO_DIA
  etapa               D-10 | D0 | D+1 | D+7 | D+15 | null
  dedupeKey UNIQUE    ex.: boleto:42:4:2026-11-26 · cobranca:42:4:2026-11-26:D+7 · confirmacao:42:3
  billId, installmentId, dueDate, customerId (Sienge), contrato
  destino             telefone E.164 (cliente ou diretoria)
  status              PLANEJADA → ENVIANDO → ENVIADA → ENTREGUE → LIDA
                      | SEM_TELEFONE | SEM_WHATSAPP | BLOQUEADA | DRY_RUN
                      | ERRO | INCERTA | CANCELADA (pagou/pausa) | IGNORADA
  canal, providerMessageId, tentativas, motivo, detalhe
  conteudo            snapshot do texto/arquivos enviados (auditoria)
  solicitadoPor       cron | painel:<usuario> | brain:sergio | brain:bruna
  criadaEm, enviadaEm, entregueEm, atualizadaEm
```

Regras de retentativa iguais às de hoje: `SEM_TELEFONE`, `SEM_WHATSAPP`,
`BLOQUEADA`, `DRY_RUN` voltam a tentar; `ERRO` até 5 vezes; `INCERTA` nunca.

### 4.3 Planejador (job diário 08:30)

1. 1 chamada bulk `income` (vencimento entre hoje−15 e hoje+10).
2. Para cada parcela em aberto (saldo > 0), sem pausa de cobrança:
   - vence em ≤ 10 dias e ainda não recebeu `BOLETO` → candidata a **boleto**
     (se o boleto ainda não existe no Sienge, fica `PLANEJADA` e é reavaliada
     no dia seguinte, até D0);
   - vence hoje → **lembrete D0**;
   - venceu há 1, 7 ou 15 dias → **cobrança** daquela etapa.
     (Se o job falhar num dia, a etapa atrasada sai no dia seguinte, sem
     duplicar: a chave da etapa é única.)
3. Agrupa por cliente: **uma mensagem por cliente por tipo**, mesmo com várias
   parcelas (ex.: mensal + semestral no mesmo dia).
4. Revalida no Sienge, reivindica, aplica travas, envia, registra.
5. Ao final, se houve boleto enviado ou falha: **relatório do dia**.

Horários (cron Railway, UTC): `30 11 * * *` (08:30 Maceió) para boletos/
lembrete/cobrança; `0 15,21 * * *` para confirmação (já existe).

### 4.4 Canal (interface)

```ts
interface CanalWhatsApp {
  nome: "evolution" | "meta";
  numeroTemWhatsApp(e164): Promise<boolean | null>;
  enviar(msg: MensagemPadrao, para: e164): Promise<ResultadoEnvio>;
}
// A regra de negócio monta UMA MensagemPadrao; cada canal decide como mandar:
type MensagemPadrao = {
  modelo: "boleto_mes" | "lembrete_vencimento" | "cobranca_atraso"
        | "confirmacao_pagamento" | "relatorio_diretoria" | ...;
  variaveis: Record<string, string>;     // nome, imóvel, vencimento, valor...
  anexo?: { nomeArquivo, mime: "application/pdf", bytes | url };
};
```

- **Evolution (hoje):** renderiza o texto livre do modelo
  (`messages.ts`) e manda texto ou documento em base64.
- **Meta (em breve):** usa o **template aprovado** com o mesmo nome do
  modelo; variáveis viram `{{1}}..{{n}}`; o anexo é enviado antes por
  `POST /{phone-id}/media` e entra como cabeçalho de documento do template.
  Respostas do cliente dentro de 24h podem ser texto livre.
- **Troca de canal** = `WHATSAPP_PROVIDER=meta` + credenciais Meta + templates
  aprovados. Nenhuma regra muda. Checklist na seção 8.

### 4.5 Status de entrega

O caso de 10/10 (Evolution respondeu "enviado" e a mensagem não chegou) mostra
que "aceito pelo canal" ≠ "entregue". Os webhooks de status (Evolution
`MESSAGES_UPDATE`, Meta `statuses`) atualizam `ENTREGUE`/`LIDA` pelo
`providerMessageId`. Mensagem sem `ENTREGUE` em 2h entra no relatório como
**não confirmada**.

### 4.6 Relatórios em PDF

- **Relatório do dia** (para Sergio e Bruna, `REPORT_RECIPIENTS`): enviado
  quando houve boleto enviado ou qualquer falha. Conteúdo: resumo (boletos,
  lembretes, cobranças, confirmações, falhas), lista de falhas com motivo e
  ação sugerida (ex.: "celular incompleto no Sienge — cliente 42"),
  inadimplentes acima de D+15, mensagens não entregues.
- **Relatório do cliente** (sob demanda): contrato, parcelas pagas/abertas
  (do Sienge), histórico de comunicações.
- Mesmo motor de PDF do recibo (`pdf-lib`, identidade Casa Forte).

### 4.7 Painel `/painel`

Substitui `/consultas`. Telas:
1. **Hoje** — o que saiu, o que vai sair, falhas (com botão "tentar de novo").
2. **Clientes** — busca por nome/CPF/contrato; ficha com parcelas (Sienge),
   linha do tempo de comunicações, ações: enviar boleto agora, reenviar
   confirmação/recibo, enviar relatório, pausar cobrança até data X.
3. **Inadimplência** — lista por atraso; seleção e envio manual (o fluxo atual).
4. **Régua** — liga/desliga cada tipo, horários, prévia do próximo job.
5. **Relatórios** — histórico dos relatórios do dia.

Todas as ações de envio passam pelo mesmo núcleo (dedupe + travas + auditoria).
Acesso: Basic Auth (hoje); login por usuário quando o Brain estiver ligado.

### 4.8 API para o Casa Forte Brain

`POST /api/brain/comandos` — `Authorization: Bearer <BRAIN_API_TOKEN>`

```json
{ "ator": "sergio" | "bruna",
  "comando": "enviar_boleto" | "enviar_relatorio_cliente" | "enviar_termo_quitacao"
           | "reenviar_confirmacao" | "status_cliente" | "listar_inadimplentes"
           | "pausar_cobranca" | "relatorio_dia",
  "cliente": { "nome"?: "...", "contrato"?: "UMAL-207", "cpf"?: "..." },
  "parcela"?: "4/60",
  "confirmar": false }
```

- **Duas etapas**: `confirmar:false` devolve a **prévia** (quem, qual parcela,
  texto, anexo) — o Brain mostra ao diretor; só com `confirmar:true` envia.
- **Desambiguação**: se o nome casar com mais de um cliente (ex.: há dois
  "Pedro"), responde `ambiguo` com as opções (nome completo + contrato).
- Comandos de leitura (`status_cliente`, `listar_inadimplentes`) não enviam nada.
- Cada comando grava `solicitadoPor = brain:<ator>`.
- Webhook de saída opcional para avisar o Brain de falhas/entregas.

### 4.9 Termo de quitação

O Sienge não tem API de termo de quitação. Proposta: gerar o PDF (mesmo motor
do recibo) **só quando todas as parcelas do contrato estiverem com saldo 0**
no Sienge, a partir de **modelo aprovado pelo jurídico**. Pendente: modelo do
texto e quem assina (o termo provavelmente exige assinatura — ver certificado
e-CNPJ A1 em `CONFIRMACAO-PAGAMENTO.md`).

### 4.10 Pausas (exceções da régua)

Tabela `PausaRegua`: cliente (todas as parcelas) ou título que não recebe
mensagens automáticas — ex.: inadimplente em negociação cujos boletos foram
cancelados para ele procurar a Casa Forte (caso Kalil, 23/10/2026). Tipos
(`TODOS` ou `BOLETO,LEMBRETE_D0,COBRANCA`), data final opcional, motivo e quem
criou. O executor pula os itens pausados (`pulados: PAUSA: <motivo>`).
Gestão: `GET/POST/DELETE /api/internal/regua/pausas` (Bearer CRON_SECRET);
depois o painel e o Brain usam a mesma rota.

## 5. Redesenho do que existe

| Hoje | Vira |
|---|---|
| `collection/regua.ts` (varre todos os contratos via REST) | planejador com 1 chamada bulk `income` |
| `CollectionSend` + `PaymentConfirmation` | `Comunicacao` (migração dos dados) |
| `Message`, `MessageEvent`, `scheduler.ts`, worker `whatsapp-outbound` | removidos (pipeline Meta antigo, sem uso) |
| `whatsapp/evolution.ts` + `whatsapp/client.ts` (Meta) | `canal/evolution.ts` e `canal/meta.ts` atrás da interface |
| `collection/messages.ts` | catálogo de modelos (texto Evolution + nome/variáveis do template Meta) |
| `payments/envio.ts` | parte do núcleo de envio |
| `/consultas` | `/painel` |
| confirmação (`payments/*`) | mantém a lógica de seleção; passa a gravar em `Comunicacao` |

## 6. Fases

**Status (21/10/2026): Fase 1 implementada** — `src/lib/canal/*` (interface +
Evolution + catálogo de modelos), `src/lib/regua/planejar.ts` (puro, testado),
`src/lib/regua/executar.ts`, tabela `Comunicacao`, rota `/api/internal/regua`,
cron `npm run cron:regua`. Validado com dados reais (21/10: 51 parcelas na janela,
plano de 21 boletos + 7 cobranças = 21 mensagens). A confirmação de pagamento
continua em `PaymentConfirmation` e migra para `Comunicacao` na Fase 2.
Ainda sem anexo PDF do boleto: o texto leva link + linha digitável.
**Atenção na 1ª ativação real:** todo boleto com vencimento nos próximos 10 dias
sai no primeiro dia (comportamento "assim que gerado").


| Fase | Entrega | Liga em produção? |
|---|---|---|
| **1. Núcleo** | `Comunicacao` + migração, interface de canal (Evolution), planejador com boleto D-10/lembrete D0/cobrança D+1/7/15, travas por tipo, tudo em **dry-run** | só dry-run |
| **2. Relatórios + painel** | relatório do dia (PDF → Sergio/Bruna), relatório do cliente, `/painel` | sim, após revisar 2–3 dias de dry-run |
| **3. Brain** | `/api/brain/comandos`, desambiguação, prévia/confirmação, auditoria | sim |
| **4. Meta** | `MetaChannel`, templates, upload de mídia, webhook de status | troca de canal |
| **5. Termo de quitação** | depois do modelo jurídico | — |

## 7. Variáveis novas (Railway)

| Variável | Uso |
|---|---|
| `BOLETO_ENABLED`, `LEMBRETE_ENABLED`, `COBRANCA_ENABLED` | trava por tipo (padrão `false`) |
| `COBRANCA_ETAPAS` | `1,7,15` |
| `BOLETO_DIAS_ANTES` | `10` |
| `REPORT_RECIPIENTS` | telefones de Sergio e Bruna (E.164, vírgula) |
| `BRAIN_API_TOKEN` | token do Casa Forte Brain |
| `WHATSAPP_PROVIDER` | `evolution` (hoje) / `meta` |

## 8. Checklist da troca para a Meta

1. Número dedicado na WhatsApp Business Platform (não pode estar na Evolution).
2. Templates aprovados, um por modelo: `boleto_mes`, `lembrete_vencimento`,
   `cobranca_atraso`, `confirmacao_pagamento`, `relatorio_diretoria`
   (+ os sob demanda). Categoria **Utility**; cabeçalho de documento onde há PDF.
3. Variáveis no Railway: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, webhook verificado.
4. Teste com a allowlist; depois liberar.
5. O PDF do boleto do Sienge (`urlReport`) é baixado e reenviado por upload
   (a Meta não aceita base64 e pode não alcançar a URL do Sienge).

## 9. Pendências

- Modelo do termo de quitação (jurídico) e assinatura.
- Telefones de Sergio e Bruna para `REPORT_RECIPIENTS`.
- Texto final das mensagens de boleto/lembrete/cobrança (tom formal, como a
  confirmação atual).
- Trocar o `CRON_SECRET` (exposto em 10/10).
