import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "../payments/logo";
import type { DadosRelatorio } from "./dados";

// PDF do relatório do dia para a diretoria (Sergio e Bruna). A4 retrato,
// identidade Casa Forte, tabelas com quebra de página. Fontes padrão (WinAnsi).

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VERMELHO = hex("#E8390E"), TEXTO = hex("#2A2A2A"), SECUNDARIO = hex("#4A4845"), SUAVE = hex("#8A8680"), FAIXA = hex("#F5F3F0"), BORDA = hex("#DDD9D3");
const A4: [number, number] = [595.28, 841.89];
const M = 40, LARG = A4[0] - 2 * M, RODAPE = M + 30;

const WINANSI = /[^\x20-\x7E -ÿ–—‘’“”•…€]/g;
const limpo = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").replace(WINANSI, "").trim();
const brl = (n: number | null) => (n == null ? "-" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const br = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "-");
const TIPO: Record<string, string> = { BOLETO: "Boleto", LEMBRETE_D0: "Lembrete", COBRANCA: "Cobrança" };
const tipoEtapa = (t: string, e: string | null) => `${TIPO[t] ?? t}${e && t === "COBRANCA" ? ` ${e}` : ""}`;

function quebrar(t: string, f: PDFFont, size: number, max: number): string[] {
  const out: string[] = []; let atual = "";
  for (const w of limpo(t).split(" ").filter(Boolean)) {
    const tent = atual ? `${atual} ${w}` : w;
    if (f.widthOfTextAtSize(tent, size) <= max) { atual = tent; continue; }
    if (atual) out.push(atual);
    atual = w;
    while (f.widthOfTextAtSize(atual, size) > max && atual.length > 1) { let n = atual.length - 1; while (n > 1 && f.widthOfTextAtSize(atual.slice(0, n), size) > max) n--; out.push(atual.slice(0, n)); atual = atual.slice(n); }
  }
  if (atual) out.push(atual);
  return out.length ? out : [""];
}

type Col = { titulo: string; w: number; direita?: boolean };

export async function gerarRelatorioPdf(d: DadosRelatorio, emitidoEm: Date, tz = "America/Maceio"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório do dia ${br(d.data)}`); pdf.setAuthor("Casa Forte"); pdf.setCreator("Casa Forte Cobrança"); pdf.setProducer("Casa Forte Cobrança");
  pdf.setCreationDate(emitidoEm); pdf.setModificationDate(emitidoEm);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);
  const emissao = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(emitidoEm);

  let page!: PDFPage; let y = 0; let pagina = 0;
  const txt = (s: string, x: number, yy: number, size: number, f: PDFFont, c: RGB = TEXTO) => page.drawText(limpo(s), { x, y: yy, size, font: f, color: c });
  const novaPagina = () => {
    page = pdf.addPage(A4); pagina++;
    page.drawLine({ start: { x: M, y: RODAPE - 8 }, end: { x: A4[0] - M, y: RODAPE - 8 }, thickness: 0.5, color: BORDA });
    txt(`Casa Forte · Relatório do dia ${br(d.data)} · emitido em ${emissao} · página ${pagina}`, M, RODAPE - 20, 7, reg, SUAVE);
    y = A4[1] - M;
  };
  const garante = (h: number) => { if (y - h < RODAPE) novaPagina(); };

  // Cabeçalho
  novaPagina();
  const lw = 90, lh = (LOGO_HEIGHT / LOGO_WIDTH) * lw;
  page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
  const titulo = "RELATÓRIO DO DIA";
  txt(titulo, A4[0] - M - neg.widthOfTextAtSize(titulo, 15), y - 24, 15, neg);
  const sub = `${br(d.data)} · comunicação financeira`;
  txt(sub, A4[0] - M - reg.widthOfTextAtSize(sub, 9), y - 39, 9, reg, SUAVE);
  y -= lh + 10;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.2, color: VERMELHO });
  y -= 18;

  // Resumo em cartões
  const r = d.resumo;
  const cards: [string, number, boolean?][] = [
    ["Boletos enviados", r.boletos], ["Lembretes", r.lembretes], ["Cobranças", r.cobrancas], ["Confirmações", r.confirmacoes],
    ["Falhas", r.falhas, r.falhas > 0], ["Aguardando boleto", r.aguardandoBoleto], ["Em teste", r.emTeste], ["Em pausa", r.pausas],
  ];
  const cw = (LARG - 3 * 8) / 4, ch = 44;
  cards.forEach(([rot, n, alerta], i) => {
    const cx = M + (i % 4) * (cw + 8), cy = y - Math.floor(i / 4) * (ch + 8);
    page.drawRectangle({ x: cx, y: cy - ch, width: cw, height: ch, color: FAIXA, borderColor: alerta ? VERMELHO : BORDA, borderWidth: alerta ? 1 : 0.5 });
    txt(String(n), cx + 10, cy - 22, 16, neg, alerta ? VERMELHO : TEXTO);
    txt(rot, cx + 10, cy - 36, 8, reg, SECUNDARIO);
  });
  y -= 2 * ch + 8 + 22;

  // Tabelas
  const secao = (t: string, nota?: string) => {
    garante(40);
    txt(t, M, y, 11, neg); y -= 4;
    page.drawLine({ start: { x: M, y: y - 2 }, end: { x: M + 40, y: y - 2 }, thickness: 1, color: VERMELHO });
    y -= 14;
    if (nota) { for (const l of quebrar(nota, reg, 8, LARG)) { txt(l, M, y, 8, reg, SUAVE); y -= 10; } y -= 2; }
  };
  const tabela = (cols: Col[], linhas: string[][], vazio: string) => {
    const head = () => {
      garante(20);
      page.drawRectangle({ x: M, y: y - 16, width: LARG, height: 16, color: FAIXA });
      let x = M; for (const c of cols) { const t = c.titulo.toUpperCase(); txt(t, c.direita ? x + c.w - 4 - neg.widthOfTextAtSize(limpo(t), 6.5) : x + 4, y - 11, 6.5, neg, SECUNDARIO); x += c.w; }
      y -= 16;
    };
    if (!linhas.length) { garante(16); txt(vazio, M, y - 10, 8, reg, SUAVE); y -= 22; return; }
    head();
    for (const ln of linhas) {
      const partes = ln.map((v, i) => quebrar(v, reg, 7.5, cols[i].w - 8));
      const h = Math.max(...partes.map((p) => p.length)) * 9.5 + 6;
      if (y - h < RODAPE) { novaPagina(); head(); }
      let x = M;
      partes.forEach((ps, i) => { ps.forEach((p, k) => { const yy = y - 10 - k * 9.5; txt(p, cols[i].direita ? x + cols[i].w - 4 - reg.widthOfTextAtSize(limpo(p), 7.5) : x + 4, yy, 7.5, reg); }); x += cols[i].w; });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: BORDA });
    }
    y -= 14;
  };

  const C_ACAO: Col[] = [{ titulo: "Cliente", w: 110 }, { titulo: "Contrato · parcela", w: 92 }, { titulo: "Venc.", w: 50 }, { titulo: "Valor", w: 62, direita: true }, { titulo: "Tipo", w: 58 }, { titulo: "Ação sugerida", w: LARG - 372 }];
  const C_LISTA: Col[] = [{ titulo: "Cliente", w: 150 }, { titulo: "Contrato · parcela", w: 110 }, { titulo: "Vencimento", w: 70 }, { titulo: "Valor", w: 80, direita: true }, { titulo: "Tipo", w: LARG - 410 }];
  const linhaCom = (i: { clienteNome: string | null; contrato: string | null; parcela: string | null; vencimento: string | null; valor: number | null; tipo: string; etapa: string | null }) =>
    [i.clienteNome ?? "-", `${i.contrato ?? "-"} · ${i.parcela ?? "-"}`, br(i.vencimento), brl(i.valor), tipoEtapa(i.tipo, i.etapa)];

  secao("Falhas — precisam de ação", "Mensagens que não saíram. A régua tenta de novo sozinha quando possível (exceto as incertas).");
  tabela(C_ACAO, [
    ...d.falhas.map((f) => [...linhaCom(f), f.acao ?? "-"]),
    ...d.confirmacoes.falhas.map((c) => ["-", `${c.contrato}`, "-", brl(c.valor), "Confirmação", c.acao]),
  ], "Nenhuma falha.");

  secao("Enviadas hoje");
  tabela(C_LISTA, d.enviadas.map(linhaCom), "Nenhuma mensagem de boleto, lembrete ou cobrança enviada.");

  secao("Confirmações de pagamento enviadas");
  tabela([{ titulo: "Contrato", w: 160 }, { titulo: "Pago em", w: 100 }, { titulo: "Valor", w: 100, direita: true }, { titulo: "Status", w: LARG - 360 }],
    d.confirmacoes.enviadas.map((c) => [c.contrato, br(c.pagoEm), brl(c.valor), "Enviada"]), "Nenhuma confirmação enviada hoje.");

  secao("Aguardando boleto no Sienge", "Parcelas em aberto sem boleto gerado/ativo. Não recebem mensagem automática até o boleto existir.");
  tabela(C_ACAO, d.aguardandoBoleto.map((a) => [...linhaCom(a), a.acao ?? "-"]), "Nenhuma.");

  if (d.emTeste.length) {
    secao("Em modo de teste (só registradas, não enviadas)", "A régua está com REGUA_DRY_RUN ligado: estas mensagens sairiam, mas foram apenas registradas.");
    tabela(C_LISTA, d.emTeste.map(linhaCom), "-");
  }

  secao("Clientes e contratos em pausa");
  tabela([{ titulo: "Cliente", w: 150 }, { titulo: "Contrato", w: 80 }, { titulo: "Tipos", w: 70 }, { titulo: "Até", w: 60 }, { titulo: "Motivo", w: LARG - 360 }],
    d.pausas.map((p) => [p.cliente ?? "-", p.contrato ?? "-", p.tipos, p.ate ? br(p.ate) : "sem prazo", p.motivo]), "Nenhuma pausa ativa.");

  return pdf.save();
}
