"use client";
import { useEffect, useState } from "react";

// Página de acompanhamento e consultas do Sienge (staging).
// READ-ONLY, PII redigida no servidor, protegida pelo Basic Auth do middleware.

type PingRes = { httpStatus: number; ok: boolean; count: number | null };
type Cliente = { nome: string | null; principal: boolean; conjuge: boolean };
type Contrato = { contratoId: number | null; numero: string | null; situacao: string | null; valor: number | null; receivableBillId: number | null; dataContrato: string | null; clientes: Cliente[]; unidades: string[] };
type Grupo = { empreendimento: string; enterpriseId: number | null; contratos: Contrato[] };

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function situacaoPill(s: string | null) {
  const t = (s ?? "").toLowerCase();
  const cls = /cancel/.test(t) ? "off" : /emit|ativ|vend|assinad/.test(t) ? "on" : "neu";
  return <span className={`tag ${cls}`}>{s ?? "—"}</span>;
}

export default function ConsultasPage() {
  const [status, setStatus] = useState<{ customers: PingRes; contracts: PingRes; units: PingRes } | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<any>(null);
  const [detalheLabel, setDetalheLabel] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [s, e] = await Promise.all([
          fetch("/api/consultas/sienge?action=status").then(r => r.json()),
          fetch("/api/consultas/sienge?action=empreendimentos").then(r => r.json()),
        ]);
        if (s?.ok) setStatus(s.status);
        if (!e?.ok) throw new Error(e?.detail || e?.error || "falha ao carregar empreendimentos");
        setGrupos(e.empreendimentos);
      } catch (err: any) { setErro(String(err?.message ?? err)); }
      finally { setLoading(false); }
    })();
  }, []);

  async function verTitulo(billId: number | null) {
    if (!billId) return;
    setDetalhe("loading"); setDetalheLabel(`Título ${billId}`);
    try {
      const d = await fetch(`/api/consultas/sienge?action=bill&billId=${billId}`).then(r => r.json());
      if (!d.ok) throw new Error(d.detail || d.error);
      setDetalhe(d);
    } catch (e: any) { setDetalhe({ erro: String(e?.message ?? e) }); }
  }

  const chip = (label: string, p?: PingRes) => (
    <span className={p?.ok ? "pill on" : "pill off"} style={{ marginRight: 8 }}>{label}: {p ? (p.ok ? p.count ?? "?" : `HTTP ${p.httpStatus}`) : "…"}</span>
  );

  const termo = busca.trim().toLowerCase();
  const gruposFiltrados = (grupos ?? [])
    .map(g => ({ ...g, contratos: termo ? g.contratos.filter(c =>
      (c.numero ?? "").toLowerCase().includes(termo) ||
      c.clientes.some(cl => (cl.nome ?? "").toLowerCase().includes(termo)) ||
      c.unidades.some(u => u.toLowerCase().includes(termo)) ||
      g.empreendimento.toLowerCase().includes(termo)) : g.contratos }))
    .filter(g => g.contratos.length > 0);

  const totalContratos = (grupos ?? []).reduce((n, g) => n + g.contratos.length, 0);

  return (
    <main>
      <header>
        <div><small>CASA FORTE · STAGING</small><h1>Consultas Sienge</h1></div>
        <a href="/" style={{ fontSize: 14 }}>← Dashboard</a>
      </header>

      <section className="panel">
        <p style={{ margin: 0 }}>{chip("Clientes", status?.customers)}{chip("Contratos", status?.contracts)}{chip("Unidades", status?.units)}</p>
        <p className="note" style={{ marginBottom: 0 }}>Somente leitura · CPF, e-mail e telefone aparecem mascarados.</p>
      </section>

      {erro && <section className="panel"><h2>Não foi possível carregar</h2><p style={{ color: "#8d1c0f" }}>{erro}</p><p className="note">Se aparecer "painel_sem_senha", defina DASHBOARD_BASIC_USER e DASHBOARD_BASIC_PASS nas Variables do Railway.</p></section>}

      {loading && <section className="panel"><p>Carregando do Sienge…</p></section>}

      {grupos && (
        <>
          <section className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div><h2 style={{ margin: 0 }}>Clientes por empreendimento</h2><span className="note">{grupos.length} empreendimentos · {totalContratos} contratos</span></div>
            <input placeholder="Buscar cliente, contrato ou unidade…" value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 280 }} />
          </section>

          {gruposFiltrados.map(g => (
            <section className="panel" key={g.empreendimento}>
              <h2 style={{ marginBottom: 4 }}>{g.empreendimento}</h2>
              <span className="note">{g.contratos.length} contrato(s)</span>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table>
                  <thead><tr><th>Contrato</th><th>Cliente(s)</th><th>Unidade(s)</th><th>Situação</th><th style={{ textAlign: "right" }}>Valor</th><th></th></tr></thead>
                  <tbody>
                    {g.contratos.map(c => (
                      <tr key={c.contratoId ?? c.numero}>
                        <td><strong>{c.numero ?? c.contratoId}</strong></td>
                        <td>{c.clientes.map((cl, i) => <div key={i}>{cl.nome}{cl.principal ? "" : cl.conjuge ? " (cônjuge)" : " (co-titular)"}</div>)}</td>
                        <td>{c.unidades.join(", ") || "—"}</td>
                        <td>{situacaoPill(c.situacao)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(c.valor)}</td>
                        <td>{c.receivableBillId ? <button className="ghost" onClick={() => verTitulo(c.receivableBillId)}>Título</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {gruposFiltrados.length === 0 && !loading && <section className="panel"><p className="note">Nenhum contrato encontrado para "{busca}".</p></section>}
        </>
      )}

      {detalhe && (
        <section className="panel">
          <h2>{detalheLabel}</h2>
          {detalhe === "loading" ? <p>Consultando…</p> : detalhe.erro ? <p style={{ color: "#8d1c0f" }}>{detalhe.erro}</p> : (
            <>
              {detalhe.normalized && <><h3 style={{ marginBottom: 4 }}>Normalizado (mapper)</h3><pre className="payload">{JSON.stringify(detalhe.normalized, null, 2)}</pre></>}
              <h3 style={{ marginBottom: 4 }}>Payload do título (redigido)</h3>
              <pre className="payload">{JSON.stringify(detalhe.payload, null, 2)}</pre>
              <p className="note">Parcelas e boleto (2ª via) ficam em endpoints separados — próximo passo do fluxo de cobrança.</p>
            </>
          )}
          <button className="ghost" onClick={() => setDetalhe(null)} style={{ marginTop: 10 }}>Fechar</button>
        </section>
      )}
    </main>
  );
}
