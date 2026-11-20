import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeInstallmentsList } from "../sienge/mapper";
import { localDateKey } from "../collection/date";
import { cadastroCliente } from "./cadastro";

// Alterações no Sienge pedidas pelo painel ou pelo Brain. Sempre em 2 passos:
//   prévia (mostra ANTES → DEPOIS, valida) e executar (depois do "Confirmo").
// Trava: com SIENGE_WRITE_DRY_RUN (padrão) nada é alterado — fica registrado
// como DRY_RUN. Toda tentativa vai para a tabela AlteracaoSienge.
// Operações (documentação oficial da API, 11/2026):
//   TELEFONES    PUT  /customers/{id}/phones          (substitui TODOS os telefones)
//   ENDERECO     PUT  /customers/{id}/addresses/{R|C}
//   BOLETO_EMAIL POST /payment-slip-notification      (2ª via no e-mail do cliente)
//   VENCIMENTO   PATCH .../installments/{id}/change-due-date (sem baixas; data ≥ hoje)

export type TelefoneNovo = { numero: string; tipo?: "CE" | "CO" | "RE"; principal?: boolean; whatsapp?: boolean; ddi?: string; observacao?: string };
export type Pedido =
  | { operacao: "TELEFONES"; customerId: number; telefones: TelefoneNovo[] }
  | { operacao: "ENDERECO"; customerId: number; tipo: "R" | "C"; logradouro: string; numero?: string; complemento?: string; bairro?: string; cidade: string; uf: string; cep?: string }
  | { operacao: "BOLETO_EMAIL"; billId: number; installmentId: number; email?: string }
  | { operacao: "VENCIMENTO"; billId: number; installmentId: number; novaData: string };

const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const br = (ymd: string) => ymd.split("-").reverse().join("/");
const TIPO_FONE: Record<string, string> = { CE: "Celular", CO: "Comercial", RE: "Residencial" };

type Plano = { ok: boolean; motivo?: string; resumo: string; antes: unknown; depois: unknown; executar: () => Promise<unknown>; customerId?: number; billId?: number; installmentId?: number };

function telefonesPayload(ts: TelefoneNovo[]) {
  if (!ts.length) throw new Error("Informe pelo menos um telefone.");
  const principais = ts.filter((t) => t.principal).length;
  const lista = ts.map((t, i) => ({ ...t, principal: principais ? Boolean(t.principal) : i === 0 }));
  if (lista.filter((t) => t.principal).length !== 1) throw new Error("Marque exatamente um telefone como principal.");
  return lista.map((t) => {
    const ddi = dig(t.ddi) || "55";
    let n = dig(t.numero);
    if (ddi === "55") {
      if (n.length >= 12 && n.startsWith("55")) n = n.slice(2);
      if (n.length < 10 || n.length > 11) throw new Error(`Telefone brasileiro inválido: ${t.numero} (use DDD + número).`);
      return { number: n, main: t.principal, type: t.tipo ?? "CE", note: t.observacao ?? "", idd: "+55", whatsapp: Boolean(t.whatsapp) };
    }
    if (n.length < 6) throw new Error(`Telefone internacional inválido: ${t.numero}.`);
    return { number: n, main: t.principal, type: t.tipo ?? "CE", note: t.observacao ?? "", idd: `+${ddi}`, whatsapp: Boolean(t.whatsapp) };
  });
}
const foneTexto = (p: { number: string; idd: string; type: string; main: boolean; whatsapp: boolean }) =>
  `${p.idd === "+55" ? `(${p.number.slice(0, 2)}) ${p.number.slice(2)}` : `${p.idd} ${p.number}`} · ${TIPO_FONE[p.type] ?? p.type}${p.main ? " · principal" : ""}${p.whatsapp ? " · WhatsApp" : ""}`;

async function planejar(p: Pedido): Promise<Plano> {
  if (p.operacao === "TELEFONES") {
    const c = await cadastroCliente(p.customerId);
    const novos = telefonesPayload(p.telefones);
    return {
      ok: true, customerId: p.customerId,
      resumo: `Substituir TODOS os telefones de ${c.nome} no Sienge.`,
      antes: c.telefones.map((t: any) => `${t.numero}${t.tipo ? ` · ${t.tipo}` : ""}${t.principal ? " · principal" : ""}${t.whatsapp ? " · WhatsApp" : ""}`),
      depois: novos.map(foneTexto),
      executar: () => sienge.atualizarTelefones(p.customerId, novos),
    };
  }
  if (p.operacao === "ENDERECO") {
    const c = await cadastroCliente(p.customerId);
    const corpo = { streetName: p.logradouro, number: p.numero ?? "", complement: p.complemento ?? "", neighborhood: p.bairro ?? "", city: p.cidade, state: p.uf.toUpperCase().slice(0, 2), zipCode: dig(p.cep) };
    if (!p.logradouro || !p.cidade || !p.uf) throw new Error("Informe logradouro, cidade e UF.");
    return {
      ok: true, customerId: p.customerId,
      resumo: `Atualizar o endereço ${p.tipo === "R" ? "RESIDENCIAL" : "COMERCIAL"} de ${c.nome} no Sienge.`,
      antes: c.enderecos.map((a: any) => [a.tipo, a.logradouro, a.complemento, a.bairro, [a.cidade, a.uf].filter(Boolean).join("/"), a.cep].filter(Boolean).join(" · ")),
      depois: [corpo.streetName, corpo.number, corpo.complement, corpo.neighborhood, `${corpo.city}/${corpo.state}`, corpo.zipCode].filter(Boolean).join(" · "),
      executar: () => sienge.atualizarEndereco(p.customerId, p.tipo, corpo),
    };
  }
  // Operações de parcela: confere no Sienge (existe, em aberto, boleto, data).
  const ps = normalizeInstallmentsList(await sienge.getInstallments(p.billId));
  const atual = ps.find((x) => x.installmentId === p.installmentId);
  if (!atual) return { ok: false, motivo: "Parcela não encontrada no Sienge.", resumo: "", antes: null, depois: null, executar: async () => null };
  const cache = await db.parcelaCache.findUnique({ where: { billId_installmentId: { billId: p.billId, installmentId: p.installmentId } } });
  const rotulo = `parcela ${cache?.parcela ?? `#${p.installmentId}`} do título ${p.billId}${cache ? ` (${cache.documento.split("/").pop()!.trim()})` : ""}`;
  const venc = atual.dueDate.toISOString().slice(0, 10);
  if (!(atual.balanceDue > 0)) return { ok: false, motivo: "A parcela já está paga.", resumo: "", antes: null, depois: null, executar: async () => null };

  if (p.operacao === "BOLETO_EMAIL") {
    if (!atual.generatedBoleto) return { ok: false, motivo: "A parcela não tem boleto gerado no Sienge.", resumo: "", antes: null, depois: null, executar: async () => null };
    const titulo = await sienge.getReceivableBill(p.billId);
    const customerId = Number(titulo?.customerId) || undefined;
    const email = (p.email ?? (customerId ? (await cadastroCliente(customerId)).email : null) ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, motivo: "Cliente sem e-mail válido (informe um e-mail).", resumo: "", antes: null, depois: null, executar: async () => null };
    const ticket = {
      receivableBillId: p.billId, installmentId: p.installmentId, emailCustomer: email,
      emailTitle: `Casa Forte — boleto da ${rotulo.split(" do título")[0]}`,
      emailBody: `Segue a 2ª via do boleto da ${rotulo.split(" do título")[0]}, com vencimento em ${br(venc)}. A senha para abrir o boleto são os 5 primeiros dígitos do seu CPF (ou CNPJ). Em caso de dúvida, fale com a Casa Forte.`,
    };
    return {
      ok: true, customerId, billId: p.billId, installmentId: p.installmentId,
      resumo: `Enviar pelo Sienge, por e-mail, a 2ª via do boleto da ${rotulo} (vencimento ${br(venc)}).`,
      antes: null, depois: { email, assunto: ticket.emailTitle },
      executar: () => sienge.enviarBoletoEmail(ticket),
    };
  }

  // VENCIMENTO
  const hoje = localDateKey(new Date(), env().TIMEZONE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.novaData)) throw new Error("Nova data no formato AAAA-MM-DD.");
  if (p.novaData < hoje) return { ok: false, motivo: "A nova data não pode ser anterior a hoje.", resumo: "", antes: null, depois: null, executar: async () => null };
  const baixas = await db.pagamentoHistorico.count({ where: { billId: p.billId, installmentId: p.installmentId } });
  if (baixas) return { ok: false, motivo: "A parcela tem baixa (pagamento parcial) — o Sienge não permite alterar o vencimento.", resumo: "", antes: null, depois: null, executar: async () => null };
  return {
    ok: true, billId: p.billId, installmentId: p.installmentId,
    resumo: `Alterar o vencimento da ${rotulo} de ${br(venc)} para ${br(p.novaData)}. A cobrança volta para "Em aberto" no Sienge (o boleto atual deixa de valer; gere um novo).`,
    antes: br(venc), depois: br(p.novaData),
    executar: () => sienge.alterarVencimento(p.billId, p.installmentId, p.novaData),
  };
}

export async function previaAlteracao(p: Pedido) {
  const pl = await planejar(p);
  return { ok: pl.ok, motivo: pl.motivo ?? null, resumo: pl.resumo, antes: pl.antes, depois: pl.depois, modoTeste: env().SIENGE_WRITE_DRY_RUN };
}

export async function executarAlteracao(p: Pedido, usuario: string) {
  const pl = await planejar(p);
  const base = { operacao: p.operacao, customerId: pl.customerId ?? null, billId: pl.billId ?? null, installmentId: pl.installmentId ?? null, antes: (pl.antes ?? undefined) as any, depois: (pl.depois ?? {}) as any, solicitadoPor: usuario };
  if (!pl.ok) return { executado: false, status: "RECUSADO", detalhe: pl.motivo };
  if (env().SIENGE_WRITE_DRY_RUN) {
    await db.alteracaoSienge.create({ data: { ...base, status: "DRY_RUN", detalhe: "SIENGE_WRITE_DRY_RUN ligado: nada foi alterado no Sienge." } });
    return { executado: false, status: "MODO_TESTE", detalhe: "Modo teste (SIENGE_WRITE_DRY_RUN): nada foi alterado no Sienge." };
  }
  try {
    await pl.executar();
    await db.alteracaoSienge.create({ data: { ...base, status: "OK" } });
    return { executado: true, status: "OK", detalhe: null };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 400);
    await db.alteracaoSienge.create({ data: { ...base, status: "ERRO", detalhe: msg } });
    return { executado: false, status: "ERRO", detalhe: msg.includes("403") ? `${msg} — o usuário da API não tem permissão para esta alteração no Sienge.` : msg };
  }
}
