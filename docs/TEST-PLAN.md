# Plano de testes antes de produção

## Fase 0 — Testes automatizados
- `npm test` deve passar 100%.
- Safety gate: master switch, dry-run, allowlist e production gate.
- Offsets D-3/D0/D+N.
- Parser dos status Meta.

## Fase 1 — Sienge somente leitura
- Criar usuário API dedicado Casa Forte.
- Consultar 1 cliente, 1 contrato, 1 unidade e 1 título conhecidos.
- Comparar valores/vencimento/status com a tela do Sienge.
- Ajustar `mapper.ts` ao payload real.
- Confirmar rate-limit e erros 401/404/429.

Critério: zero divergência em uma amostra manual de 20 parcelas.

## Fase 2 — Webhooks Sienge em staging
- Registrar somente os eventos necessários.
- Alterar uma parcela de teste no Sienge.
- Confirmar `IntegrationEvent`, job BullMQ e atualização local.
- Reenviar o mesmo evento / simular duplicata: não pode duplicar efeitos.
- Simular worker fora do ar e retorno: job deve ser retomado.

Critério: 100 eventos de teste sem duplicidade/perda.

## Fase 3 — WhatsApp dry-run
`OUTBOUND_MESSAGING_ENABLED=false`, `WHATSAPP_DRY_RUN=true`.
- Rodar régua contra dados de staging.
- Conferir quem RECEBERIA cada mensagem.
- Conferir templates/valores/datas sem chamada Meta.

Critério: revisão humana de 100% das mensagens geradas por pelo menos 3 dias úteis.

## Fase 4 — WhatsApp real somente equipe Casa Forte
`OUTBOUND_MESSAGING_ENABLED=true`, `WHATSAPP_DRY_RUN=false`, allowlist só da equipe.
- Templates aprovados na Meta.
- Enviar D-3/D0/D+3 para números internos usando dados fictícios/controlados.
- Validar sent/delivered/read/failed.
- Validar botão/link/PDF quando implementado.

Critério: 30 mensagens reais internas sem erro de conteúdo.

## Fase 5 — Piloto controlado
- Escolher 5–10 clientes previamente autorizados/adequados ao piloto.
- Manter allowlist explícita.
- Usar apenas lembrete pré-vencimento inicialmente; sem cobrança pós-vencimento agressiva.
- Financeiro confere Sienge antes/depois.

Critério: 2 ciclos de vencimento sem cobrança indevida.

## Fase 6 — Produção gradual
- Ativar por empreendimento ou grupo de clientes.
- Manter kill switch.
- Monitorar falhas, opt-outs, respostas e divergências.
- Somente depois considerar `WHATSAPP_ALLOW_ALL_PRODUCTION=true`.

## Casos que obrigatoriamente devem bloquear envio
- Parcela paga entre agendamento e envio.
- Baixa parcial.
- Parcela cancelada.
- Cliente pausado/em negociação.
- Telefone sem opt-in/consentimento aplicável.
- Sem número válido.
- Boleto rejeitado ou indisponível quando a mensagem promete boleto.
- Resposta Sienge ambígua/erro de integração.
