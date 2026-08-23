# Templates de WhatsApp — Casa Forte Cobrança

Mensagens **proativas** de cobrança exigem **template aprovado** na Meta
(WhatsApp Business Platform). Submeta os 3 templates abaixo no
**WhatsApp Manager → Modelos de mensagem**, categoria **Utilidade (Utility)**,
idioma **Português (BR)**. Os nomes precisam bater com o `seed.ts`/env.

Parâmetros (mesma ordem nos três): `{{1}}` nome · `{{2}}` imóvel (empreendimento
+ unidade) · `{{3}}` vencimento (dd/mm/aaaa) · `{{4}}` valor.

O **boleto** vai junto (documento ou link). Depende de liberar a permissão do
recurso `payment-slip-notification` para o usuário de API no Sienge (hoje: 403).

---

## 1. `cf_cobranca_d_menos_10` — 10 dias antes
> Olá, {{1}}! Aqui é da Casa Forte. A parcela do seu imóvel {{2}} vence em {{3}} (faltam 10 dias), no valor de {{4}}. Segue o boleto para pagamento. Qualquer dúvida, é só responder por aqui.

## 2. `cf_cobranca_vence_hoje` — no vencimento (D0)
> Olá, {{1}}! A parcela do seu imóvel {{2}} vence hoje ({{3}}), no valor de {{4}}. Segue o boleto. Se o pagamento já foi feito, por favor desconsidere. Obrigado! — Casa Forte

## 3. `cf_cobranca_atraso_1d` — 1 dia após, se em aberto (D+1)
> Olá, {{1}}. A parcela do seu imóvel {{2}}, com vencimento em {{3}} ({{4}}), consta em aberto. Segue o boleto atualizado. Se já efetuou o pagamento, desconsidere; para negociar, fale com a gente. — Casa Forte

---

## Variáveis de ambiente (Railway) opcionais
Se aprovar com outros nomes, defina no Railway:
```
WA_TEMPLATE_D_MINUS_10=cf_cobranca_d_menos_10
WA_TEMPLATE_DUE_TODAY=cf_cobranca_vence_hoje
WA_TEMPLATE_D_PLUS_1=cf_cobranca_atraso_1d
WA_TEMPLATE_LANGUAGE=pt_BR
```

## Ordem de ativação (não pular etapas)
1. Templates aprovados na Meta + `WHATSAPP_*` (Phone Number ID, WABA, token, verify, app secret) no Railway.
2. Webhook do Sienge registrado em staging (evento de boleto/parcela).
3. Habilitar as regras (`CollectionRule.enabled=true`) — ainda em dry-run.
4. Conferir no painel "o que SERIA enviado".
5. `WHATSAPP_DRY_RUN=false` + `OUTBOUND_MESSAGING_ENABLED=true` + allowlist (só equipe).
6. Piloto 5–10 clientes → expansão → `WHATSAPP_ALLOW_ALL_PRODUCTION=true` (autorização explícita).
