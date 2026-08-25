import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sienge } from "@/lib/sienge/client";
import { extrairPessoasDaProposta, mapPessoaToSienge, type PessoaContrato } from "@/lib/sienge/customer-map";
import { redactText } from "@/lib/redact";

export const dynamic = "force-dynamic";

// Gateway Sienge: cadastra no Sienge os CLIENTES de um contrato assinado.
// Chamado pelo webhook do ZapSign (casaforte-contratos) com Bearer CRON_SECRET.
// Body: { proposta } (dados_json.proposta) OU { pessoas: [...] }.
// SEMPRE deduplica por CPF antes de criar. Grava de verdade só com
// SIENGE_WRITE_DRY_RUN=false — caso contrário devolve o payload que SERIA
// enviado (dry-run). Não expõe credenciais.
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const e = env();
  const dryRun = e.SIENGE_WRITE_DRY_RUN;
  const cfg = { typeId: e.SIENGE_CUSTOMER_TYPE_ID, personType: e.SIENGE_PERSON_TYPE_FISICA, sex: e.SIENGE_DEFAULT_SEX, mailing: e.SIENGE_DEFAULT_MAILING };

  // Para gravar de verdade, os campos obrigatórios do Sienge precisam estar
  // configurados: typeId, personType, gênero e correspondência.
  if (!dryRun) {
    const faltando = [
      !cfg.typeId && "SIENGE_CUSTOMER_TYPE_ID",
      !cfg.personType && "SIENGE_PERSON_TYPE_FISICA",
      !cfg.sex && "SIENGE_DEFAULT_SEX",
      !cfg.mailing && "SIENGE_DEFAULT_MAILING",
    ].filter(Boolean);
    if (faltando.length) return NextResponse.json({ ok: false, error: "config_incompleta", detail: `Defina no Railway: ${faltando.join(", ")}.` }, { status: 409 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const pessoas = Array.isArray(body?.pessoas)
    ? (body.pessoas as PessoaContrato[]).map((pessoa) => ({ papel: "pessoa", pessoa }))
    : extrairPessoasDaProposta(body?.proposta);

  if (!pessoas.length) return NextResponse.json({ ok: false, error: "sem_pessoas" }, { status: 400 });

  const resultados: any[] = [];
  for (const { papel, pessoa } of pessoas) {
    const cpf = String(pessoa.cpf ?? "").replace(/\D/g, "");
    const nome = String(pessoa.nome ?? "").trim();
    try {
      if (!cpf) { resultados.push({ papel, nome, status: "SEM_CPF" }); continue; }
      const existente = await sienge.searchCustomerByCpf(cpf);
      if (existente) { resultados.push({ papel, nome, status: "JA_EXISTE", siengeId: existente?.id ?? null }); continue; }

      const payload = mapPessoaToSienge(pessoa, cfg);
      if (dryRun) { resultados.push({ papel, nome, status: "DRY_RUN", payload }); continue; }

      const r = await sienge.createCustomer(payload);
      resultados.push({ papel, nome, status: "CRIADO", siengeId: r.id, httpStatus: r.status });
    } catch (err: any) {
      resultados.push({ papel, nome, status: "ERRO", detail: redactText(String(err?.message ?? err)).slice(0, 300) });
    }
  }

  const contagem = resultados.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {} as Record<string, number>);
  return NextResponse.json({ ok: true, dryRun, typeId: cfg.typeId || null, personType: cfg.personType || null, total: pessoas.length, contagem, resultados });
}
