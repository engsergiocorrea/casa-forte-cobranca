# Mapeamento Sienge v0.1

Base REST:
`https://api.sienge.com.br/{subdominio}/public/api/v1/{recurso}`

Autenticação: HTTP Basic com credenciais do usuário de API do Painel de Integrações.

## Endpoints
| Domínio | Endpoint | Uso |
|---|---|---|
| Cliente | GET `/customers/{id}` | nome e contatos |
| Contrato | GET `/sales-contracts/{id}` | vínculo da venda |
| Unidade | GET `/units/{id}` | unidade do imóvel |
| Título | GET `/accounts-receivable/receivable-bills/{receivableBillId}` | dados financeiros oficiais |
| Boleto | GET `/payment-slip-notification?billReceivableId=X&installmentId=Y` | segunda via |
| Webhooks | `/hooks` | cadastro/consulta |

## Webhook headers úteis
- `x-sienge-tenant`
- `x-sienge-event`
- `x-sienge-hook-id`
- `x-sienge-id` — usar como chave de idempotência
- `user-agent: sienge-hooks`

O Sienge espera resposta do receptor rapidamente; o endpoint deve apenas persistir + enfileirar e responder 202. Processamento pesado fica no worker.
