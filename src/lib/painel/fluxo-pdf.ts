import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "../payments/logo";
import { fluxoDaObra, type Fluxo } from "./fluxo";

// Relatório "Previsão de fluxo de caixa" (A4 retrato, identidade Casa Forte):
// resumo geral, mês a mês (todas as obras) e uma seção por obra.

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VERMELHO = hex("#E8390E"), AZUL = hex("#2B59C3"), TEXTO = hex("#2A2A2A"), SECUNDARIO = hex("#4A4845"), SUAVE = hex("#8A8680"), FAIXA = hex("#F5F3F0"), BORDA = hex("#DDD9D3");
const A4: [number, number] = [595.28, 841.89];
const M = 40, LARG = A4[0] - 2 * M, RODAPE = M + 30;
const WINANSI = /[^\x20-\x7E -ÿ–—‘’“”•…€]/g;
const limpo = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").replace(WINANSI, "").trim();
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (ymd: string) => ymd.split("-").reverse().join("/");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;

export async function gerarFluxoPdf(f: Fluxo, tz = "America/Maceio"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const emitido = new Date();
  pdf.setTitle(`Previsão de fluxo de caixa ${br(f.hoje)}`); pdf.setAuthor("Casa Forte"); pdf.setCreator("Casa Forte Cobrança");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);
  const emissao = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(emitido);
  let page!: PDFPage; let y = 0; let pagina = 0;
  const txt = (s: string, x: number, yy: number, size: number, ft: PDFFont, c: RGB = TEXTO) => page.drawText(limpo(s), { x, y: yy, size, font: ft, color: c });
  const dir = (s: string, xr: number, yy: number, size: number, ft: PDFFont, c: RGB = TEXTO) => txt(s, xr - ft.widthOfTextAtSize(limpo(s), size), yy, size, ft, c);
  const nova = () => {
    page = pdf.addPage(A4); pagina++;
    page.drawLine({ start: { x: M, y: RODAPE - 8 }, end: { x: A4[0] - M, y: RODAPE - 8 }, thickness: 0.5, color: BORDA });
    txt(`Casa Forte · Previsão de fluxo de caixa · emitido em ${emissao} · página ${pagina}`, M, RODAPE - 20, 7, reg, SUAVE);
    y = A4[1] - M;
  };
  const garante = (h: number) => { if (y - h < RODAPE) nova(); };

  nova();
  const lw = 90, lh = (LOGO_HEIGHT / LOGO_WIDTH) * lw;
  page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
  dir("PREVISÃO DE FLUXO DE CAIXA", A4[0] - M, y - 24, 15, neg);
  dir(`Entradas dos contratos de venda · posição de ${br(f.hoje)}`, A4[0] - M, y - 39, 9, reg, SUAVE);
  y -= lh + 10;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.2, color: VERMELHO });
  y -= 16;
  for (const l of [
    "Saldos lidos no Sienge na emissão, com a correção monetária de hoje (o mesmo valor do boleto). Correções futuras não estão incluídas.",
    `Recebido = pagamentos registrados no Sienge${f.historicoAtualizadoEm ? ` (atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(f.historicoAtualizadoEm))})` : ""}. Vencido em aberto aparece à parte e não entra nos meses futuros.`,
  ]) { txt(l, M, y, 7.5, reg, SECUNDARIO); y -= 10; }
  if (f.falhas) { txt(`Atenção: ${f.falhas} contrato(s) não puderam ser lidos no Sienge nesta emissão.`, M, y, 7.5, neg, VERMELHO); y -= 10; }
  y -= 8;

  const cartoes = (t: ReturnType<typeof fluxoDaObra>["totais"]) => {
    const cs: [string, string, boolean?][] = [["A receber (total)", brl(t.aReceber)], ["Vencido em aberto", brl(t.vencido), t.vencido > 0], ["Próximos 3 meses", brl(t.proximos3)], ["Próximos 12 meses", brl(t.proximos12)], ["Recebido (últimos 6 meses)", brl(t.recebido6)]];
    const cw = (LARG - 4 * 6) / 5, ch = 40;
    garante(ch + 10);
    cs.forEach(([r, v, al], i) => {
      const x = M + i * (cw + 6);
      page.drawRectangle({ x, y: y - ch, width: cw, height: ch, color: FAIXA, borderColor: al ? VERMELHO : BORDA, borderWidth: al ? 1 : 0.5 });
      txt(v, x + 7, y - 18, 9.5, neg, al ? VERMELHO : TEXTO);
      txt(r, x + 7, y - 31, 6.8, reg, SECUNDARIO);
    });
    y -= ch + 16;
  };
  const secao = (t: string) => { garante(70); txt(t, M, y, 11, neg); page.drawLine({ start: { x: M, y: y - 5 }, end: { x: M + 40, y: y - 5 }, thickness: 1, color: VERMELHO }); y -= 20; };
  const tabelaMeses = (ms: { mes: string; recebido: number; aReceber: number }[]) => {
    const cols = [M + 4, M + 200, M + 340, A4[0] - M - 4];
    const head = () => { garante(18); page.drawRectangle({ x: M, y: y - 15, width: LARG, height: 15, color: FAIXA }); txt("MÊS", cols[0], y - 10.5, 6.5, neg, SECUNDARIO); dir("RECEBIDO", cols[1], y - 10.5, 6.5, neg, SECUNDARIO); dir("A RECEBER", cols[2], y - 10.5, 6.5, neg, SECUNDARIO); dir("TOTAL DO MÊS", cols[3], y - 10.5, 6.5, neg, SECUNDARIO); y -= 15; };
    head();
    let tr = 0, ta = 0;
    for (const m of ms) {
      if (y - 14 < RODAPE) { nova(); head(); }
      tr += m.recebido; ta += m.aReceber;
      txt(nomeMes(m.mes), cols[0], y - 10, 8, reg);
      dir(m.recebido ? brl(m.recebido) : "—", cols[1], y - 10, 8, reg, m.recebido ? AZUL : SUAVE);
      dir(m.aReceber ? brl(m.aReceber) : "—", cols[2], y - 10, 8, reg, m.aReceber ? VERMELHO : SUAVE);
      dir(brl(m.recebido + m.aReceber), cols[3], y - 10, 8, neg);
      y -= 14; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: BORDA });
    }
    garante(16);
    txt("Total do período", cols[0], y - 11, 8, neg); dir(brl(tr), cols[1], y - 11, 8, neg); dir(brl(ta), cols[2], y - 11, 8, neg); dir(brl(tr + ta), cols[3], y - 11, 8, neg);
    y -= 28;
  };

  secao("Todas as obras");
  const geral = fluxoDaObra(f, null);
  cartoes(geral.totais);
  tabelaMeses(geral.meses);

  secao("Resumo por obra");
  {
    const cols = [M + 4, M + 245, M + 330, M + 415, A4[0] - M - 4];
    garante(18); page.drawRectangle({ x: M, y: y - 15, width: LARG, height: 15, color: FAIXA });
    txt("OBRA", cols[0], y - 10.5, 6.5, neg, SECUNDARIO); dir("VENCIDO", cols[1], y - 10.5, 6.5, neg, SECUNDARIO); dir("PRÓX. 3 MESES", cols[2], y - 10.5, 6.5, neg, SECUNDARIO); dir("PRÓX. 12 MESES", cols[3], y - 10.5, 6.5, neg, SECUNDARIO); dir("TOTAL A RECEBER", cols[4], y - 10.5, 6.5, neg, SECUNDARIO); y -= 15;
    for (const e of f.empreendimentos) {
      garante(14);
      txt(e.nome, cols[0], y - 10, 8, reg); dir(brl(e.vencido), cols[1], y - 10, 8, reg, e.vencido ? VERMELHO : TEXTO); dir(brl(e.proximos3), cols[2], y - 10, 8, reg); dir(brl(e.proximos12), cols[3], y - 10, 8, reg); dir(brl(e.total), cols[4], y - 10, 8, neg);
      y -= 14; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: BORDA });
    }
    y -= 20;
  }

  for (const e of f.empreendimentos) {
    nova();
    secao(e.nome);
    const o = fluxoDaObra(f, e.nome);
    cartoes(o.totais);
    tabelaMeses(o.meses);
  }
  return pdf.save();
}
