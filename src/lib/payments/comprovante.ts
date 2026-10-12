import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "./logo";
import type { NormalizedIncomeInstallment } from "../sienge/mapper";

// Recibo de pagamento em PDF gerado por NÓS (o Sienge não tem API de recibo),
// no mesmo modelo do recibo do Sienge: uma página por parcela, com
// "Título / Parcela: 34 - 4/60" (nº da parcela no plano, NÃO o installmentId),
// Tipo Parc, Documento, Centro de Custo, Unidade e os valores da baixa.
// Todos os dados vêm do Sienge (bulk-data /income/by-bills) — nenhum cálculo
// financeiro nosso. Fontes padrão (Helvetica, WinAnsi): acentos ok, sem emoji.
// Não inclui CPF nem telefone (vai por WhatsApp).

export type ParcelaRecibo = {
  titulo: number;       // billId
  parcela: string;      // "4/60"
  tipoParc: string;     // "PM"
  unidade: string;      // "R - 211"
  documento: string;    // "CT / UMAR-211"
  centroCusto: string;  // "2 - UMÁ MILAGRES"
  vencimento: string;   // dd/mm/aaaa
  valor: number;        // bruto da baixa
  seguro: number;
  desconto: number;
  acrescimos: number;   // juros + multa da baixa (só aparece se > 0)
  liquido: number;
  pagoEm: string;       // yyyy-mm-dd (data do recibo)
};
export type EmpresaRecibo = { nome: string; cnpj?: string; endereco?: string; cidade?: string };
export type DadosRecibo = { empresa: EmpresaRecibo; clienteNome: string; parcelas: ParcelaRecibo[] };
export type OpcoesComprovante = { emitidoEm: Date; timeZone?: string; legalLine?: string };

// Dados cadastrais da empresa, iguais aos do recibo do Sienge (companyId do
// Sienge → CNPJ/endereço). Empresa fora da tabela sai só com o nome.
export const EMPRESAS: Record<number, Omit<EmpresaRecibo, "nome">> = {
  2: { cnpj: "37.301.810/0001-98", endereco: "AV ALVARO OTACILIO, 3731 - JATIUCA - Maceió/Alagoas - 57036-850", cidade: "Maceió" },
};
export function empresaDe(companyId: number | null, companyName: string): EmpresaRecibo {
  return { nome: companyName || "CASA FORTE", ...(companyId != null ? EMPRESAS[companyId] : undefined) };
}

const brData = (ymd: string) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "");

// Escolhe a baixa que gerou os movimentos bancários confirmados (mesmo
// bankMovementId); sem cruzamento, a última baixa de Recebimento.
export function montarParcelaRecibo(inc: NormalizedIncomeInstallment, movementIds: number[]): ParcelaRecibo {
  const ids = new Set(movementIds);
  const recebimentos = inc.baixas.filter((b) => /receb|adiant/i.test(b.operacao));
  const baixa = inc.baixas.find((b) => b.bankMovementIds.some((id) => ids.has(id)))
    ?? recebimentos.sort((a, b) => a.pagoEm.localeCompare(b.pagoEm)).at(-1);
  if (!baixa) throw new Error(`Sem baixa no Sienge para ${inc.billId}/${inc.installmentId}`);
  if (!inc.parcela) throw new Error(`Sem número da parcela no Sienge para ${inc.billId}/${inc.installmentId}`);
  return {
    titulo: inc.billId, parcela: inc.parcela, tipoParc: inc.tipoParc, unidade: inc.unidade,
    documento: inc.documento, centroCusto: inc.centroCusto, vencimento: brData(inc.vencimento),
    valor: baixa.bruto, seguro: baixa.seguro, desconto: baixa.desconto,
    acrescimos: Math.round((baixa.juros + baixa.multa) * 100) / 100, liquido: baixa.liquido, pagoEm: baixa.pagoEm,
  };
}

// --- Texto -------------------------------------------------------------------

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

const UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, w: string[] = [];
  if (c) w.push(CT[c]);
  if (r > 0 && r < 20) w.push(UN[r]);
  else if (r >= 20) w.push(r % 10 ? `${DZ[Math.floor(r / 10)]} e ${UN[r % 10]}` : DZ[Math.floor(r / 10)]);
  return w.join(" e ");
}
function inteiroPorExtenso(n: number): string {
  const b = Math.floor(n / 1e9), m = Math.floor(n / 1e6) % 1000, t = Math.floor(n / 1000) % 1000, u = n % 1000;
  const partes: string[] = [];
  if (b) partes.push(b === 1 ? "um bilhão" : `${ate999(b)} bilhões`);
  if (m) partes.push(m === 1 ? "um milhão" : `${ate999(m)} milhões`);
  if (t) partes.push(t === 1 ? "mil" : `${ate999(t)} mil`);
  if (u) partes.push(ate999(u));
  if (partes.length < 2) return partes[0] ?? "zero";
  const ultimo = partes.pop()!;
  return `${partes.join(" ")}${u && (u < 100 || u % 100 === 0) ? " e " : " "}${ultimo}`;
}
// 4200.54 → "quatro mil e duzentos reais e cinquenta e quatro centavos" (igual ao Sienge).
export function valorPorExtenso(valor: number): string {
  const centavosTotal = Math.round((Number(valor) || 0) * 100);
  const inteiro = Math.floor(centavosTotal / 100), cent = centavosTotal % 100;
  const reais = inteiro === 1 ? "um real"
    : `${inteiroPorExtenso(inteiro)}${inteiro >= 1e6 && inteiro % 1e6 === 0 ? " de reais" : " reais"}`;
  const centavos = cent ? `${ate999(cent)} ${cent === 1 ? "centavo" : "centavos"}` : "";
  if (inteiro && centavos) return `${reais} e ${centavos}`;
  return centavos || reais;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
// "2026-09-09" → "9 de Setembro de 2026" (como no recibo do Sienge).
export function dataPorExtenso(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// --- PDF ---------------------------------------------------------------------

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VERMELHO = hex("#E8390E");
const TEXTO = hex("#2A2A2A");
const SUAVE = hex("#8A8680");
const BORDA = hex("#DDD9D3");

const A4: [number, number] = [595.28, 841.89];
const M = 45;
const DIREITA = A4[0] - M;
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

export async function gerarComprovantePdf(d: DadosRecibo, o: OpcoesComprovante): Promise<Uint8Array> {
  if (!d.parcelas.length) throw new Error("Recibo sem parcelas");
  const tz = o.timeZone ?? "America/Maceio";
  const emissao = dataHora(o.emitidoEm, tz);

  const pdf = await PDFDocument.create();
  pdf.setTitle("Recibo de pagamento");
  pdf.setAuthor(d.empresa.nome);
  pdf.setCreator("Casa Forte Cobrança");
  pdf.setProducer("Casa Forte Cobrança");
  pdf.setCreationDate(o.emitidoEm);
  pdf.setModificationDate(o.emitidoEm);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);

  const texto = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = TEXTO) =>
    page.drawText(limpo(s), { x, y, size, font, color });
  const largura = (s: string, size: number, font: PDFFont) => font.widthOfTextAtSize(limpo(s), size);
  const aDireita = (page: PDFPage, s: string, xDir: number, y: number, size: number, font: PDFFont, color = TEXTO) =>
    texto(page, s, xDir - largura(s, size, font), y, size, font, color);
  const centro = (page: PDFPage, s: string, y: number, size: number, font: PDFFont, color = TEXTO) =>
    texto(page, s, (A4[0] - largura(s, size, font)) / 2, y, size, font, color);
  // "Rótulo : valor" com o rótulo alinhado à direita em `x` (como no Sienge).
  const campo = (page: PDFPage, rotulo: string, valor: string, x: number, y: number) => {
    aDireita(page, `${rotulo} :`, x, y, 9.5, negrito);
    texto(page, valor, x + 4, y, 9.5, regular);
  };

  for (const p of d.parcelas) {
    const page = pdf.addPage(A4);
    const topo = A4[1] - 50;

    // Cabeçalho: empresa/CNPJ à esquerda, logo à direita.
    texto(page, `Empresa : ${d.empresa.nome}`, M, topo, 10, negrito);
    if (d.empresa.cnpj) texto(page, `CNPJ : ${d.empresa.cnpj}`, M, topo - 14, 10, negrito);
    const logoW = 85, logoH = (LOGO_HEIGHT / LOGO_WIDTH) * logoW;
    page.drawImage(logo, { x: DIREITA - logoW, y: topo - logoH + 12, width: logoW, height: logoH });

    centro(page, "RECIBO", topo - 82, 18, negrito);
    page.drawLine({ start: { x: A4[0] / 2 - 40, y: topo - 90 }, end: { x: A4[0] / 2 + 40, y: topo - 90 }, thickness: 1.2, color: VERMELHO });

    // Campos — mesma grade do recibo do Sienge.
    const X1 = 140, X2 = 335, X3 = 470, LH = 15;
    let y = topo - 125;
    campo(page, "Imóvel", p.unidade, X1, y);
    y -= LH;
    campo(page, "Documento", p.documento, X1, y);
    campo(page, "Titulo / Parcela", `${p.titulo} - ${p.parcela}`, X2, y);
    campo(page, "Tipo Parc", p.tipoParc, X3, y);
    y -= LH; campo(page, "Centro Custo", p.centroCusto, X1, y);
    y -= LH; campo(page, "Unidades", p.unidade, X1, y);
    y -= LH; campo(page, "Vencimento", p.vencimento, X1, y);
    y -= LH;
    campo(page, "Valor", fmtBRL(p.valor), X1, y);
    campo(page, "Desconto", fmtBRL(p.desconto), X2, y);
    campo(page, "Líquido", fmtBRL(p.liquido), X3, y);
    y -= LH;
    campo(page, "Seguro", fmtBRL(p.seguro), X1, y);
    if (p.acrescimos > 0) campo(page, "Juros / Multa", fmtBRL(p.acrescimos), X2, y);

    // Declaração.
    y -= 38;
    const declaracao = `Recebemos de ${d.clienteNome} a importância supra de ${fmtBRL(p.liquido)} (${valorPorExtenso(p.liquido)}), referente a sua liquidação (da parcela acima citada).`;
    for (const l of quebrar(declaracao, regular, 9.5, DIREITA - M)) { texto(page, l, M, y, 9.5, regular); y -= 13.5; }

    // Local e data (data do pagamento), linha de assinatura e empresa.
    y -= 26;
    centro(page, `${d.empresa.cidade ?? "Maceió"}, ${dataPorExtenso(p.pagoEm)}`, y, 10, regular);
    y -= 48;
    page.drawLine({ start: { x: A4[0] / 2 - 150, y }, end: { x: A4[0] / 2 + 150, y }, thickness: 0.6, color: TEXTO });
    centro(page, d.empresa.nome, y - 13, 9.5, regular);
    aDireita(page, "Via Cliente", DIREITA, y - 45, 9.5, regular);

    // Rodapé: endereço | emissão; aviso de emissão automática.
    const fy = M + 46;
    page.drawLine({ start: { x: M, y: fy }, end: { x: DIREITA, y: fy }, thickness: 0.6, color: BORDA });
    if (d.empresa.endereco) texto(page, d.empresa.endereco, M, fy - 12, 8, regular);
    aDireita(page, `Emitido em ${emissao.data} ${emissao.hora}`, DIREITA, fy - 12, 8, regular);
    let ry = fy - 26;
    const aviso = `Recibo emitido automaticamente pela Casa Forte a partir da baixa registrada no Sienge (${tz}). Não substitui o termo de quitação do contrato.`;
    for (const l of quebrar(aviso, regular, 7, DIREITA - M)) { texto(page, l, M, ry, 7, regular, SUAVE); ry -= 9; }
    if (o.legalLine?.trim()) for (const l of quebrar(o.legalLine, regular, 7, DIREITA - M)) { texto(page, l, M, ry, 7, regular, SUAVE); ry -= 9; }
    texto(page, "casaforteinc.com.br", M, ry - 1, 7.5, negrito, VERMELHO);
  }

  return pdf.save();
}
