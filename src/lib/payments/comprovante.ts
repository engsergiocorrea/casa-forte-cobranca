import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "./logo";

// "Comprovante de pagamento" em PDF gerado por NÓS (o Sienge não tem API de
// recibo). Função pura: recebe os dados prontos e devolve os bytes do PDF.
// Os valores são exatamente os da mensagem (valor líquido de selecao.ts) —
// nenhum cálculo financeiro novo além da soma do total exibido.
// Fontes padrão (Helvetica, WinAnsi): cobre acentos, NÃO cobre emoji.

export type ParcelaComprovante = {
  imovel: string;     // "UMÁ MILAGRES — R - 05"
  contrato: string;   // "UMAR-05"
  parcela: number;    // installmentId
  vencimento: string; // dd/mm/aaaa
  pagoEm: string;     // dd/mm/aaaa
  valor: number;      // líquido
};
export type DadosComprovante = { clienteNome: string; parcelas: ParcelaComprovante[] };
export type OpcoesComprovante = { emitidoEm: Date; timeZone?: string; legalLine?: string };

// Cores do casaforte-site.
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VERMELHO = hex("#E8390E");
const TEXTO = hex("#2A2A2A");
const SECUNDARIO = hex("#4A4845");
const SUAVE = hex("#8A8680");
const FAIXA = hex("#F5F3F0");
const BORDA = hex("#DDD9D3");

const A4: [number, number] = [595.28, 841.89];
const M = 50;                     // margem
const LARGURA = A4[0] - 2 * M;    // 495.28
const COLUNAS = [
  { titulo: "Imóvel", w: 150 },
  { titulo: "Contrato · parcela", w: 135 },
  { titulo: "Vencimento", w: 62 },
  { titulo: "Pago em", w: 62 },
  { titulo: "Valor", w: LARGURA - 150 - 135 - 62 - 62, direita: true },
];
const PAD = 6;
const RODAPE_TOPO = M + 58; // a tabela não desce abaixo disto

const PARTICULAS = new Set(["de", "da", "do", "dos", "das", "e"]);

// "MARIA DA SILVA D'ÁVILA" → "Maria da Silva D'Ávila".
export function nomeProprio(nome: string): string {
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
  return String(nome ?? "").trim().toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean)
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.split(/([-'’])/).map(cap).join("")))
    .join(" ");
}

// comprovante-pagamento-UMAR-05-08-10-2026.pdf
export function nomeArquivoComprovante(contrato: string, pagoEm: string): string {
  const c = String(contrato ?? "").trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "contrato";
  return `comprovante-pagamento-${c}-${String(pagoEm).replace(/\//g, "-")}.pdf`;
}

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function dataHora(d: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { data: `${g("day")}/${g("month")}/${g("year")}`, hora: `${g("hour")}:${g("minute")}` };
}

// Remove o que a Helvetica (WinAnsi) não codifica — emoji etc. — em vez de quebrar.
const WINANSI = /[^\x20-\x7E -ÿ–—‘’“”•…€]/g;
const limpo = (s: string) => String(s ?? "").replace(/\s+/g, " ").replace(WINANSI, "").trim();

function quebrar(texto: string, font: PDFFont, size: number, max: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of limpo(texto).split(" ").filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(tentativa, size) <= max) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    // palavra maior que a coluna: corta no caractere
    let resto = palavra;
    while (font.widthOfTextAtSize(resto, size) > max) {
      let n = resto.length - 1;
      while (n > 1 && font.widthOfTextAtSize(resto.slice(0, n), size) > max) n--;
      linhas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

export async function gerarComprovantePdf(d: DadosComprovante, o: OpcoesComprovante): Promise<Uint8Array> {
  if (!d.parcelas.length) throw new Error("Comprovante sem parcelas");
  const tz = o.timeZone ?? "America/Maceio";
  const emissao = dataHora(o.emitidoEm, tz);

  const pdf = await PDFDocument.create();
  pdf.setTitle("Comprovante de pagamento");
  pdf.setAuthor("Casa Forte");
  pdf.setCreator("Casa Forte Cobrança");
  pdf.setProducer("Casa Forte Cobrança");
  pdf.setCreationDate(o.emitidoEm);
  pdf.setModificationDate(o.emitidoEm);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);

  const texto = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color: RGB) =>
    page.drawText(limpo(s), { x, y, size, font, color });
  const direita = (page: PDFPage, s: string, xDir: number, y: number, size: number, font: PDFFont, color: RGB) =>
    texto(page, s, xDir - font.widthOfTextAtSize(limpo(s), size), y, size, font, color);

  const rodape = (page: PDFPage) => {
    page.drawLine({ start: { x: M, y: M + 44 }, end: { x: A4[0] - M, y: M + 44 }, thickness: 0.5, color: BORDA });
    let y = M + 32;
    const aviso = `Documento emitido automaticamente em ${emissao.data} às ${emissao.hora} (${tz}). Não substitui o termo de quitação do contrato.`;
    for (const l of quebrar(aviso, regular, 7.5, LARGURA)) { texto(page, l, M, y, 7.5, regular, SUAVE); y -= 10; }
    if (o.legalLine?.trim()) for (const l of quebrar(o.legalLine, regular, 7.5, LARGURA)) { texto(page, l, M, y, 7.5, regular, SUAVE); y -= 10; }
    texto(page, "casaforteinc.com.br", M, y - 2, 8, negrito, VERMELHO);
  };

  const cabecalhoTabela = (page: PDFPage, y: number) => {
    const h = 22;
    page.drawRectangle({ x: M, y: y - h, width: LARGURA, height: h, color: FAIXA });
    page.drawLine({ start: { x: M, y: y - h }, end: { x: A4[0] - M, y: y - h }, thickness: 0.75, color: BORDA });
    let x = M;
    for (const c of COLUNAS) {
      if (c.direita) direita(page, c.titulo.toUpperCase(), x + c.w - PAD, y - 14.5, 7.5, negrito, SECUNDARIO);
      else texto(page, c.titulo.toUpperCase(), x + PAD, y - 14.5, 7.5, negrito, SECUNDARIO);
      x += c.w;
    }
    return y - h;
  };

  const novaPagina = () => { const p = pdf.addPage(A4); rodape(p); return p; };

  // --- Página 1: cabeçalho ---
  let page = novaPagina();
  const topo = A4[1] - 40;
  const logoW = 120, logoH = (LOGO_HEIGHT / LOGO_WIDTH) * logoW;
  page.drawImage(logo, { x: M, y: topo - logoH, width: logoW, height: logoH });
  direita(page, "COMPROVANTE DE PAGAMENTO", A4[0] - M, topo - 32, 15, negrito, TEXTO);
  direita(page, `Emitido em ${emissao.data}`, A4[0] - M, topo - 49, 9, regular, SUAVE);
  const linhaY = topo - logoH - 12;
  page.drawLine({ start: { x: M, y: linhaY }, end: { x: A4[0] - M, y: linhaY }, thickness: 1.2, color: VERMELHO });

  let y = linhaY - 32;
  texto(page, "CLIENTE", M, y, 8, negrito, SUAVE);
  y -= 17;
  texto(page, nomeProprio(d.clienteNome) || "Cliente", M, y, 13, negrito, TEXTO);

  y -= 30;
  const plural = d.parcelas.length > 1;
  const intro = `A Casa Forte confirma o recebimento ${plural ? "dos pagamentos" : "do pagamento"} abaixo, conforme registrado em seu sistema financeiro.`;
  for (const l of quebrar(intro, regular, 10, LARGURA)) { texto(page, l, M, y, 10, regular, SECUNDARIO); y -= 14; }

  // --- Tabela ---
  y -= 12;
  y = cabecalhoTabela(page, y);
  for (const p of d.parcelas) {
    const celulas = [p.imovel, `${p.contrato} · parcela ${p.parcela}`, p.vencimento, p.pagoEm, fmtBRL(p.valor)];
    const linhas = celulas.map((c, i) => quebrar(c, regular, 9, COLUNAS[i].w - 2 * PAD));
    const h = Math.max(...linhas.map((l) => l.length)) * 12 + 12;
    if (y - h < RODAPE_TOPO) { page = novaPagina(); y = cabecalhoTabela(page, A4[1] - M); }
    let x = M;
    linhas.forEach((ls, i) => {
      ls.forEach((l, k) => {
        const ly = y - 15 - k * 12;
        if (COLUNAS[i].direita) direita(page, l, x + COLUNAS[i].w - PAD, ly, 9, regular, TEXTO);
        else texto(page, l, x + PAD, ly, 9, regular, TEXTO);
      });
      x += COLUNAS[i].w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.5, color: BORDA });
  }

  if (plural) {
    const h = 24;
    if (y - h < RODAPE_TOPO) { page = novaPagina(); y = A4[1] - M; }
    const total = Math.round(d.parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0) * 100) / 100;
    page.drawRectangle({ x: M, y: y - h, width: LARGURA, height: h, color: FAIXA });
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: VERMELHO });
    texto(page, "TOTAL", M + PAD, y - 16, 9, negrito, TEXTO);
    direita(page, fmtBRL(total), A4[0] - M - PAD, y - 16, 10, negrito, TEXTO);
  }

  return pdf.save();
}
