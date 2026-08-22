# CLAUDE.md — Casa Forte Cobrança

Você está trabalhando no ecossistema interno da Casa Forte Incorporadora e Construtora.

## Objetivo
Construir um sistema próprio de comunicação financeira, inicialmente focado em WhatsApp, substituindo o Nano como camada de relacionamento. O Sienge continua sendo a fonte financeira oficial e continua enviando e-mail nesta fase.

## Stack já escolhida
- Railway
- Next.js + TypeScript
- PostgreSQL + Prisma
- Redis + BullMQ
- Worker Node/TS
- Sienge REST API + Webhooks
- WhatsApp Business Platform (Cloud API oficial)

## Regras não negociáveis de segurança
1. NÃO remova nem contorne `OUTBOUND_MESSAGING_ENABLED`, `WHATSAPP_DRY_RUN`, allowlist ou `WHATSAPP_ALLOW_ALL_PRODUCTION`.
2. Nenhum cliente real recebe mensagem enquanto `APP_MODE=staging`, exceto números explicitamente na allowlist e somente após desligar dry-run.
3. Toda cobrança deve ser revalidada no Sienge imediatamente antes do envio.
4. Parcela paga, cancelada, parcialmente paga, pausada ou com dados ambíguos = NÃO ENVIAR.
5. Nunca calcule saldo/juros/multa como fonte de verdade. Obtenha o valor atual do Sienge.
6. Webhooks devem ser idempotentes. Use `x-sienge-id` e external message id.
7. Preserve payload bruto redigido para auditoria durante staging; não exponha CPF/telefone em logs de produção.
8. Antes de produção, exigir assinatura do webhook Meta (`WHATSAPP_APP_SECRET`) e segredo longo na URL do webhook Sienge.

## Primeira tarefa ao abrir este repo
1. Rodar testes.
2. Subir PostgreSQL + Redis locais/Railway staging.
3. Criar migration inicial e seed.
4. Configurar credencial de API Sienge com somente os recursos necessários.
5. Fazer um GET manual de um título de TESTE conhecido.
6. Comparar payload real com `src/lib/sienge/mapper.ts` e corrigir o mapper com tipos explícitos. Não inventar campos.
7. Registrar webhooks Sienge somente no ambiente staging.
8. Confirmar que eventos entram no banco e worker sincroniza sem enviar WhatsApp.

## Recursos Sienge que precisamos
- Clientes: GET /customers/{id}
- Contratos de venda: GET /sales-contracts/{id}, GET /sales-contracts
- Unidades: GET /units/{id}, GET /units
- Títulos a receber: GET /accounts-receivable/receivable-bills/{receivableBillId}
- Segunda via: GET /payment-slip-notification?billReceivableId=...&installmentId=...
- Gerenciamento de webhooks: GET/POST/DELETE /hooks...

Eventos prioritários:
- CUSTOMER_CREATED / CUSTOMER_UPDATED
- SALES_CONTRACT_CREATED / UPDATED / ISSUED / CANCELED
- UNIT_CREATED / UPDATED
- RECEIVABLE_INSTALLMENT_CREATED / UPDATED / REMOVED
- UPDATE_RECEIVABLE_BILL_SITUATION
- RECEIPT_PROCESSED
- BOOK_COLLECTION_CONFIRMED
- PAYMENT_SLIP_REGISTERED

## MVP funcional
A sequência é:
Sienge webhook -> IntegrationEvent -> BullMQ -> sync local -> scheduler da régua -> Message -> fila WhatsApp -> revalidação Sienge -> safety gate -> WhatsApp -> webhook de status -> timeline.

## Próximas telas
1. Dashboard
2. Clientes
3. Cliente/contrato/unidade + timeline
4. Parcelas abertas/vencidas
5. Régua de cobrança
6. Fila/erros
7. Pausas de cobrança
8. Configurações/integrações

## Não fazer agora
- Não substituir e-mail do Sienge.
- Não criar cálculo financeiro paralelo.
- Não ativar D+ cobrança para toda base.
- Não criar portal do cliente antes de estabilizar cobrança WhatsApp.
