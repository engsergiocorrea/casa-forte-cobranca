// Relatório do dia (Fase 2) — monta os dados a partir do que foi registrado.
// PURO: recebe as linhas já lidas do banco e devolve a estrutura do relatório.
// Ver docs/ARQUITETURA-COMUNICACAO.md §4.6.

export type LinhaComunicacao = {
  tipo: string; etapa: string | null; status: string; motivo: string | null;
  clienteNome: string | null; contrato: string | null; parcela: string | null;
  vencimento: string | null; // yyyy-mm-dd
  valor: number | null;
};
export type LinhaConfirmacao = { contrato: string; status: string; motivo: string | null; detail: string | null; valor: number; pagoEm: string };
export type LinhaPausa = { cliente: string | null; contrato: string | null; tipos: string; ate: string | null; motivo: string };

export type ItemRelatorio = LinhaComunicacao & { acao?: string };

export type DadosRelatorio = {
  data: string; // yyyy-mm-dd
  resumo: { boletos: number; lembretes: number; cobrancas: number; confirmacoes: number; falhas: number; emTeste: number; aguardandoBoleto: number; pausas: number };
  enviadas: ItemRelatorio[];
  falhas: ItemRelatorio[];
  aguardandoBoleto: ItemRelatorio[];
  emTeste: ItemRelatorio[];
  confirmacoes: { enviadas: LinhaConfirmacao[]; falhas: (LinhaConfirmacao & { acao: string })[] };
  pausas: LinhaPausa[];
};

const ENVIADA = ["ENVIADA", "ENTREGUE", "LIDA"];
const FALHA = ["SEM_TELEFONE", "SEM_WHATSAPP", "ERRO", "INCERTA", "BLOQUEADA"];

// O que o financeiro deve fazer para cada tipo de falha.
export function acaoSugerida(status: string, motivo?: string | null): string {
  switch (status) {
    case "SEM_TELEFONE": case "NO_PHONE": return "Cadastrar o celular do cliente no Sienge";
    case "SEM_WHATSAPP": case "NO_WHATSAPP": return "Conferir o celular no Sienge (DDI, DDD e 9 dígitos)";
    case "ERRO": case "ERROR": return "Verificar a conexão do WhatsApp (Evolution); nova tentativa automática";
    case "INCERTA": case "UNCERTAIN": return "Conferir no WhatsApp se a mensagem saiu (não é reenviada sozinha)";
    case "BLOQUEADA": case "BLOCKED": return `Envio bloqueado pelas travas (${motivo ?? "-"})`;
    case "PLANEJADA":
      if (motivo === "BOLETO_AINDA_NAO_GERADO") return "Gerar o boleto no Sienge (sai assim que existir, até o vencimento)";
      if (motivo === "SEM_BOLETO_ATIVO") return "Sem boleto ativo no Sienge (cancelado ou não gerado): não é cobrado automaticamente";
      return "Aguardando próxima execução";
    default: return "-";
  }
}

export function montarRelatorio(data: string, rows: LinhaComunicacao[], confs: LinhaConfirmacao[], pausas: LinhaPausa[]): DadosRelatorio {
  const com = (r: LinhaComunicacao): ItemRelatorio => ({ ...r, acao: acaoSugerida(r.status, r.motivo) });
  const enviadas = rows.filter((r) => ENVIADA.includes(r.status));
  const falhas = rows.filter((r) => FALHA.includes(r.status)).map(com);
  const aguardandoBoleto = rows.filter((r) => r.status === "PLANEJADA").map(com);
  const emTeste = rows.filter((r) => r.status === "DRY_RUN");
  const confEnv = confs.filter((c) => c.status === "SENT");
  const confFal = confs.filter((c) => ["NO_PHONE", "NO_WHATSAPP", "ERROR", "UNCERTAIN", "BLOCKED"].includes(c.status)).map((c) => ({ ...c, acao: acaoSugerida(c.status, c.motivo) }));
  const conta = (t: string) => enviadas.filter((r) => r.tipo === t).length;
  return {
    data,
    resumo: {
      boletos: conta("BOLETO"), lembretes: conta("LEMBRETE_D0"), cobrancas: conta("COBRANCA"),
      confirmacoes: confEnv.length, falhas: falhas.length + confFal.length, emTeste: emTeste.length,
      aguardandoBoleto: aguardandoBoleto.length, pausas: pausas.length,
    },
    enviadas, falhas, aguardandoBoleto, emTeste,
    confirmacoes: { enviadas: confEnv, falhas: confFal },
    pausas,
  };
}

// Regra do envio automático: só no dia em que houve boleto enviado ou falha.
export function deveEnviarAutomatico(d: DadosRelatorio): boolean {
  return d.resumo.boletos > 0 || d.resumo.falhas > 0;
}

// Legenda curta que acompanha o PDF no WhatsApp.
export function legendaRelatorio(d: DadosRelatorio): string {
  const r = d.resumo, br = d.data.split("-").reverse().join("/");
  return [
    `📊 Relatório do dia ${br} — Casa Forte`,
    ``,
    `📄 Boletos enviados: ${r.boletos}`,
    `📅 Lembretes: ${r.lembretes}`,
    `⚠️ Cobranças: ${r.cobrancas}`,
    `✅ Confirmações de pagamento: ${r.confirmacoes}`,
    r.falhas ? `❗ Falhas: ${r.falhas} (ação sugerida no PDF)` : `✔️ Nenhuma falha`,
    r.aguardandoBoleto ? `⏳ Aguardando boleto no Sienge: ${r.aguardandoBoleto}` : null,
    r.emTeste ? `🧪 Em modo de teste (só registradas): ${r.emTeste}` : null,
    r.pausas ? `⏸️ Clientes/contratos em pausa: ${r.pausas}` : null,
  ].filter((x) => x !== null).join("\n");
}
