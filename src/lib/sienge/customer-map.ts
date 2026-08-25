// Mapeia as pessoas de um contrato assinado (casaforte-contratos,
// dados_json.proposta) para o payload do POST /customers do Sienge.
// Cônjuge entra EMBUTIDO no titular (naturalPersonData.spouse) — é como o
// Sienge trata casais. Envia só os campos seguros (sem enums de risco como
// civilStatus/sex) para evitar 400; dá pra enriquecer depois.

export type PessoaContrato = {
  nome?: string | null;
  cpf?: string | null;
  email?: string | null;
  nascimento?: string | null;
  profissao?: string | null;
  rg?: string | null;
  telefone?: string | null;
  conjuge?: PessoaContrato | null;
};

export type PessoaComPapel = { papel: string; pessoa: PessoaContrato };

const dig = (v: any) => String(v ?? "").replace(/\D/g, "");
const txt = (v: any) => { const s = String(v ?? "").trim(); return s || undefined; };

// Datas do contrato ("dd/mm/aaaa" ou "aaaa-mm-dd") → "aaaa-mm-dd".
export function toIsoDate(v: any): string | undefined {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

// Telefone brasileiro → { ddd, number } (sem DDI). Ex.: "(82) 99999-9999".
export function splitPhoneBR(v: any): { ddd: string; number: string } | undefined {
  let d = dig(v);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length < 10) return undefined;
  return { ddd: d.slice(0, 2), number: d.slice(2) };
}

function pruneUndefined<T extends Record<string, any>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export function mapPessoaToSienge(p: PessoaContrato, cfg: { typeId: string; personType: string }): any {
  const cpf = dig(p.cpf);
  const phone = splitPhoneBR(p.telefone);
  const spouse = p.conjuge && txt(p.conjuge.nome)
    ? pruneUndefined({
        name: txt(p.conjuge.nome),
        cpf: dig(p.conjuge.cpf) || undefined,
        birthDate: toIsoDate(p.conjuge.nascimento),
        profession: txt(p.conjuge.profissao),
        numberIdentityCard: txt(p.conjuge.rg),
        email: txt(p.conjuge.email),
      })
    : undefined;

  const naturalPersonData = pruneUndefined({
    name: txt(p.nome),
    cpf: cpf || undefined,
    email: txt(p.email),
    birthDate: toIsoDate(p.nascimento),
    profession: txt(p.profissao),
    numberIdentityCard: txt(p.rg),
    spouse,
  });

  return pruneUndefined({
    personType: cfg.personType || undefined,
    typeId: cfg.typeId ? Number(cfg.typeId) : undefined,
    naturalPersonData,
    phones: phone ? [pruneUndefined({ ddd: phone.ddd, number: phone.number, main: true })] : undefined,
  });
}

// Extrai as pessoas a cadastrar da proposta: compradores, cônjuges (embutidos)
// e proprietários. Dedup por CPF na própria lista.
export function extrairPessoasDaProposta(proposta: any): PessoaComPapel[] {
  const p = proposta ?? {};
  const out: PessoaComPapel[] = [];
  const add = (papel: string, pessoa: any, conjuge?: any) => {
    if (!pessoa || !txt(pessoa.nome)) return;
    out.push({ papel, pessoa: { ...pessoa, conjuge: conjuge && txt(conjuge?.nome) ? conjuge : pessoa.conjuge ?? null } });
  };
  add("comprador_principal", p.comprador_principal, p.conjuge);
  add("comprador_adicional", p.comprador_adicional, p.comprador_adicional?.conjuge);
  const props = Array.isArray(p.proprietarios) ? p.proprietarios : [];
  props.forEach((pr: any, i: number) => add(`proprietario_${i + 1}`, pr, pr?.conjuge));

  // Dedup por CPF (mantém o primeiro papel encontrado).
  const vistos = new Set<string>();
  return out.filter((x) => {
    const c = dig(x.pessoa.cpf);
    const key = c || `nome:${txt(x.pessoa.nome)?.toLowerCase()}`;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
}
