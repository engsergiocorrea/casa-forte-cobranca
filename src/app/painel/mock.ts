// Dados FICTÍCIOS para revisar o layout do painel localmente (sem banco/Sienge).
// Só é usado em http://localhost…?mock=1 — nunca em produção (ver api() em Painel.tsx).

const hoje = new Date().toISOString().slice(0, 10);
const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const linha = (o: any) => ({ tipo: "BOLETO", etapa: "D-10", status: "ENVIADA", motivo: null, clienteNome: "MARIA DAS GRAÇAS EXEMPLO", contrato: "UMAR-01", parcela: "3/60", vencimento: d(10), valor: 4193, ...o });

const relatorio = {
  data: hoje,
  resumo: { boletos: 3, lembretes: 1, cobrancas: 2, confirmacoes: 4, falhas: 2, emTeste: 5, aguardandoBoleto: 2, pausas: 1 },
  enviadas: [linha({}), linha({ clienteNome: "JOÃO PEDRO DOS SANTOS EXEMPLO", contrato: "UMAL-04", parcela: "5/60", valor: 2760.92 }), linha({ tipo: "COBRANCA", etapa: "D+1", clienteNome: "ANA EXEMPLO", contrato: "UMAR205", vencimento: d(-1) })],
  falhas: [
    { ...linha({ status: "SEM_WHATSAPP", clienteNome: "PEDRO MARIA DA COSTA EXEMPLO", contrato: "UMAL-207" }), acao: "Conferir o celular no Sienge (DDI, DDD e 9 dígitos)" },
    { ...linha({ status: "SEM_TELEFONE", clienteNome: "THOMAS EXEMPLO", contrato: "0952", valor: 10 }), acao: "Cadastrar o celular do cliente no Sienge" },
  ],
  aguardandoBoleto: [
    { ...linha({ status: "PLANEJADA", motivo: "BOLETO_AINDA_NAO_GERADO", clienteNome: "HUMBERTO OTAVIANO DE SOUZA EXEMPLO", contrato: "002-107", parcela: "5/10", valor: 19546.89 }), acao: "Gerar o boleto no Sienge (sai assim que existir, até o vencimento)" },
    { ...linha({ status: "PLANEJADA", motivo: "SEM_BOLETO_ATIVO", tipo: "COBRANCA", etapa: "D+15", clienteNome: "KALIL EXEMPLO", contrato: "SANTORINI-008", parcela: "8/60", valor: 5000 }), acao: "Sem boleto ativo no Sienge (cancelado ou não gerado): não é cobrado automaticamente" },
  ],
  emTeste: [linha({ status: "DRY_RUN" }), linha({ status: "DRY_RUN", contrato: "UMAA03", parcela: "4/4", valor: 17118.75 })],
  confirmacoes: { enviadas: [{ contrato: "UMAB201", status: "SENT", motivo: null, detail: null, valor: 20842.67, pagoEm: hoje }], falhas: [{ contrato: "SANTORINI102", status: "ERROR", motivo: null, detail: "Evolution status 500", valor: 7955.46, pagoEm: hoje, acao: "Verificar a conexão do WhatsApp (Evolution); nova tentativa automática" }] },
  pausas: [{ cliente: "KALIL EXEMPLO", contrato: "SANTORINI-008", tipos: "TODOS", ate: null, motivo: "Em negociação" }],
};

const config = { envioLigado: true, whatsappTeste: false, reguaTeste: true, boleto: true, lembrete: true, cobranca: true, etapas: [1, 7, 15], diasAntes: 10, relatorioAuto: false, destinatariosRelatorio: 2, canal: "evolution" };

const parcelas = (billId: number) => [
  { billId, installmentId: 5, parcela: "4/60", tipoParc: "PM", vencimento: d(-8), saldo: 4193, paga: false, boletoGerado: true, diasAteVencimento: -8 },
  { billId, installmentId: 6, parcela: "5/60", tipoParc: "PM", vencimento: d(0), saldo: 4193, paga: false, boletoGerado: true, diasAteVencimento: 0 },
  { billId, installmentId: 7, parcela: "6/60", tipoParc: "PM", vencimento: d(9), saldo: 4193, paga: false, boletoGerado: false, diasAteVencimento: 9 },
  { billId, installmentId: 8, parcela: "1/10", tipoParc: "PM", vencimento: d(9), saldo: 15094.8, paga: false, boletoGerado: true, diasAteVencimento: 9 },
];

export function mockApi(url: string, init?: RequestInit): any {
  const u = new URL(url, "http://x");
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  switch (u.pathname) {
    case "/api/painel/resumo": return { usuario: "demo", data: hoje, config, relatorio };
    case "/api/painel/clientes": return [
      { customerId: 1, nome: "MARIA DAS GRAÇAS DE SOUZA E SILVA EXEMPLO", contratos: [{ numero: "UMAR-01", empreendimento: "UMÁ MILAGRES", unidades: ["R - 01"] }] },
      { customerId: 2, nome: "KALIL EXEMPLO", contratos: [{ numero: "SANTORINI-008", empreendimento: "SANTORINI", unidades: ["CASA 008"] }, { numero: "UMAR210", empreendimento: "UMÁ MILAGRES", unidades: ["R - 210"] }] },
    ];
    case "/api/painel/cliente": return {
      customerId: 1, nome: "MARIA DAS GRAÇAS DE SOUZA E SILVA EXEMPLO", telefone: "+5582999990000",
      contratos: [{ numero: "UMAR-01", empreendimento: "UMÁ MILAGRES", unidades: ["R - 01"], situacao: "Emitido", billId: 99, parcelas: parcelas(99) }],
      comunicacoes: [{ tipo: "BOLETO", etapa: "D-10", status: "ENVIADA", contrato: "UMAR-01", parcela: "3/60", valor: 4193, solicitadoPor: "cron", enviadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString() },
        { tipo: "COBRANCA", etapa: "MANUAL", status: "SEM_WHATSAPP", motivo: "NUMERO_SEM_WHATSAPP", contrato: "UMAR-01", parcela: "4/60", valor: 4193, solicitadoPor: "painel:bruna", atualizadaEm: new Date().toISOString() }],
      confirmacoes: [{ contrato: "UMAR-01", installmentId: 4, status: "SENT", valor: 4100, pagoEm: d(-30), enviadaEm: new Date().toISOString() }],
      pausas: u.searchParams.get("customerId") === "2" ? [{ id: "p1", tipos: "TODOS", ate: null, motivo: "Em negociação" }] : [],
    };
    case "/api/painel/envio":
      if (corpo.acao === "enviar") return { customerId: corpo.customerId, nome: "MARIA EXEMPLO", enviado: true, status: "ENVIADA", ignorados: [] };
      return { tipo: corpo.tipo, customerId: corpo.customerId, nome: "MARIA DAS GRAÇAS EXEMPLO", telefone: "+5582999990000", prontos: corpo.itens, bloqueados: [], avisos: ["Exemplo de aviso: cliente em PAUSA da régua (Em negociação)."],
        mensagem: "📄 Boleto disponível\n\nMaria, segue o boleto da parcela do seu imóvel:\n\n🏠 UMÁ MILAGRES — R - 01\n\n📄 Parcela 4/60\n📅 Vencimento: 30/10/2026\n💰 R$ 4.193,00\n🔢 Linha digitável: 23793234019000000001905000161009216110000648629\n🔗 Boleto: https://casaforteinc.sienge.com.br/sienge/visualizar-relatorio?arquivo=16484651729807416337&formato=pdf\n\n🔒 A senha para abrir o boleto são os 5 primeiros dígitos do seu CPF (ou CNPJ).\n\n🤖 Esta é uma mensagem automática da Casa Forte. Em caso de dúvida, basta responder esta mensagem.\n\n#aquiécasaforte" };
    case "/api/painel/inadimplentes": return [
      { customerId: 1, cliente: "MARIA DAS GRAÇAS EXEMPLO", contrato: "UMAR-01", empreendimento: "UMÁ MILAGRES", unidades: "R - 01", billId: 99, installmentId: 5, parcela: "4/60", vencimento: d(-8), diasAtraso: 8, saldo: 4193, boletoGerado: true, pausa: null, ultimaCobranca: new Date().toISOString() },
      { customerId: 2, cliente: "KALIL EXEMPLO", contrato: "SANTORINI-008", empreendimento: "SANTORINI", unidades: "CASA 008", billId: 43, installmentId: 12, parcela: "8/60", vencimento: d(-18), diasAtraso: 18, saldo: 5000, boletoGerado: false, pausa: "Em negociação", ultimaCobranca: null },
    ];
    case "/api/painel/pausas": return [{ id: "p1", cliente: "KALIL EXEMPLO", contrato: "SANTORINI-008", customerId: 2, tipos: "TODOS", ate: null, motivo: "Inadimplente em negociação: boletos cancelados", criadoPor: "manual", criadaEm: new Date().toISOString() }];
    case "/api/painel/regua": return { parcelasLidas: 53, planejadas: { BOLETO: 21, LEMBRETE_D0: 1, COBRANCA: 7 }, jaTratadas: 0, mensagens: 2, porStatus: {}, pulados: [{ billId: 43, installmentId: 12, tipo: "COBRANCA", motivo: "PAUSA: Em negociação" }],
      previews: [{ tipo: "BOLETO", nome: "Maria", telefone: "+•••••••••000", parcelas: [{}], mensagem: "📄 Boleto disponível\n\nMaria, segue o boleto…" }] };
    case "/api/painel/historico": return [
      { quando: new Date().toISOString(), tipo: "BOLETO", etapa: "D-10", status: "ENVIADA", cliente: "MARIA EXEMPLO", contrato: "UMAR-01", parcela: "3/60", valor: 4193, solicitadoPor: "cron" },
      { quando: new Date().toISOString(), tipo: "CONFIRMACAO", etapa: null, status: "SENT", cliente: null, contrato: "UMAB201", parcela: null, valor: 20842.67, solicitadoPor: "cron" },
    ];
    case "/api/painel/brain":
      if (init?.method === "POST") return { resposta: corpo.mensagem === "Confirmo" ? "Operação executada com sucesso." : "Encontrei *2 parcelas* em atraso há mais de 15 dias:\n\n• KALIL EXEMPLO — SANTORINI-008 · 8/60 · 18 dias · R$ 5.000,00 (em pausa)\n• MARIA EXEMPLO — UMAR-01 · 4/60 · 16 dias · R$ 4.193,00\n\nQuer que eu envie a cobrança da Maria? Vou mostrar a mensagem antes.\n\nResponda \"Confirmo\" para executar ou \"Cancelar\"." };
      return { configurado: true, liberado: true, usuario: "sergio" };
    default: return {};
  }
}
