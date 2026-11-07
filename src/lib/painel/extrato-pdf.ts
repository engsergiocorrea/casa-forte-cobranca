import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "../payments/logo";
import type { FichaCliente } from "./ficha";

// Extrato do cliente em PDF: todas as parcelas de cada contrato, com
// pagamento (data/valor), saldo corrigido e situação. A4 retrato.

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VERMELHO = hex("#E8390E"), VERDE = hex("#1E7F4F"), AMBAR = hex("#9A6A00"), TEXTO = hex("#2A2A2A"), SECUNDARIO = hex("#4A4845"), SUAVE = hex("#8A8680"), FAIXA = hex("#F5F3F0"), BORDA = hex("#DDD9D3");
const A4: [number, number] = [595.28, 841.89];
const M = 36, LARG = A4[0] - 2 * M, RODAPE = M + 28;
const WINANSI = /[^\x20-\x7E -ÿ–—‘’“”•…€]/g;
const limpo = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").replace(WINANSI, "").trim();
const brl = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const br = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "-");

function situacao(p: any): [string, RGB] {
  // Extrato vai para o cliente: parcela quitada aparece só como "Paga" (sem dias de atraso).
  if (p.paga) return ["Paga", VERDE];
  const pre = p.parcial ? "Parcial · " : "";
  if (p.diasAteVencimento < 0) return [`${pre}${-p.diasAteVencimento} d em atraso`, VERMELHO];
  if (p.diasAteVencimento === 0) return [`${pre}Vence hoje`, AMBAR];
  return [`${pre}A vencer`, SECUNDARIO];
}

export async function gerarExtratoPdf(f: FichaCliente, tz = "America/Maceio"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const agora = new Date();
  pdf.setTitle(`Extrato ${f.nome}`); pdf.setAuthor("Casa Forte"); pdf.setCreator("Casa Forte Cobrança");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);
  const emissao = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(agora);
  let page!: PDFPage; let y = 0; let pagina = 0;
  const txt = (s: string, x: number, yy: number, size: number, ft: PDFFont, c: RGB = TEXTO) => page.drawText(limpo(s), { x, y: yy, size, font: ft, color: c });
  const dir = (s: string, xr: number, yy: number, size: number, ft: PDFFont, c: RGB = TEXTO) => txt(s, xr - ft.widthOfTextAtSize(limpo(s), size), yy, size, ft, c);
  const nova = () => {
    page = pdf.addPage(A4); pagina++;
    page.drawLine({ start: { x: M, y: RODAPE - 8 }, end: { x: A4[0] - M, y: RODAPE - 8 }, thickness: 0.5, color: BORDA });
    txt(`Casa Forte · Extrato de ${f.nome} · emitido em ${emissao} · página ${pagina}`, M, RODAPE - 20, 7, reg, SUAVE);
    y = A4[1] - M;
  };
  nova();
  const lw = 84, lh = (LOGO_HEIGHT / LOGO_WIDTH) * lw;
  page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
  dir("EXTRATO DO CLIENTE", A4[0] - M, y - 22, 15, neg);
  dir(limpo(f.nome), A4[0] - M, y - 37, 9.5, neg, SECUNDARIO);
  dir("Valores em aberto com a correção monetária de hoje (= valor do boleto).", A4[0] - M, y - 50, 7.5, reg, SUAVE);
  y -= lh + 8;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.2, color: VERMELHO });
  y -= 18;

  const cols = [{ t: "PARCELA", x: M + 4 }, { t: "VENCIMENTO", x: M + 82 }, { t: "VALOR", x: M + 210, d: true }, { t: "PAGAMENTO", x: M + 222 }, { t: "SALDO", x: M + 418, d: true }, { t: "SITUAÇÃO", x: M + 428 }];
  const head = () => { page.drawRectangle({ x: M, y: y - 14, width: LARG, height: 14, color: FAIXA }); for (const c of cols) (c.d ? dir : txt)(c.t, c.x, y - 9.5, 6.3, neg, SECUNDARIO); y -= 14; };
  for (const c of f.contratos as any[]) {
    if (y - 90 < RODAPE) nova();
    txt(`${c.numero} · ${c.empreendimento} ${c.unidades.join(", ")}`, M, y, 11, neg); y -= 5;
    page.drawLine({ start: { x: M, y: y - 2 }, end: { x: M + 40, y: y - 2 }, thickness: 1, color: VERMELHO }); y -= 14;
    const r = c.resumo;
    if (r) {
      txt(`${r.criadas} parcelas · ${r.pagas} pagas · ${r.emAberto} em aberto · ${r.vencidas} vencidas`, M, y, 8, reg, SECUNDARIO); y -= 11;
      txt(`Valor do contrato ${brl(r.valorContrato)} · Pago ${brl(r.totalPago)} · Em aberto ${brl(r.saldoAberto)}${r.vencidas ? ` · Vencido ${brl(r.saldoVencido)}` : ""}`, M, y, 8, neg); y -= 14;
    }
    head();
    for (const p of c.parcelas as any[]) {
      if (y - 13 < RODAPE) { nova(); head(); }
      const [sit, cor] = situacao(p);
      txt(p.parcela ? `${p.parcela} ${p.tipoParc ?? ""}` : `#${p.installmentId}`, cols[0].x, y - 9.5, 7.5, reg);
      txt(br(p.vencimento), cols[1].x, y - 9.5, 7.5, reg);
      dir(brl(p.valorOriginal ?? (p.paga ? p.valorPago : p.saldo)), cols[2].x, y - 9.5, 7.5, reg);
      txt(p.pagoEm ? `${br(p.pagoEm)} · ${brl(p.valorPago)}${p.jurosMulta ? ` (+${brl(p.jurosMulta)})` : ""}` : "-", cols[3].x, y - 9.5, 7.5, reg, p.pagoEm ? TEXTO : SUAVE);
      dir(p.paga ? "-" : brl(p.saldo), cols[4].x, y - 9.5, 7.5, p.paga ? reg : neg, p.paga ? SUAVE : TEXTO);
      txt(sit, cols[5].x, y - 9.5, 7.2, neg, cor);
      y -= 13; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.3, color: BORDA });
    }
    y -= 20;
  }
  return pdf.save();
}
