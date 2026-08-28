"use client";
import { useEffect, useState } from "react";

// Página de cobrança. Para o OPERADOR: mostra só os inadimplentes (com filtro
// por empreendimento), marcar → revisar → confirmar → enviar. As ferramentas de
// configuração (status, prontidão, régua, consultas) ficam escondidas atrás de
// ?setup=1, para não confundir quem não construiu o sistema.

type PingRes = { ok: boolean; httpStatus: number; count: number | null };
type Cliente = { nome: string | null; customerId: number | null; principal: boolean; conjuge: boolean };
type TelCliente = { customerId: number; nome: string | null; telefones: { numero: string; tipo: string | null; principal: boolean }[] };
type Contrato = { contratoId: number | null; numero: string | null; situacao: string | null; valor: number | null; receivableBillId: number | null; clientes: Cliente[]; unidades: string[] };
type Grupo = { empreendimento: string; contratos: Contrato[] };
type Parcela = { installmentId: number; vencimento: string; saldo: number; saldoFmt: string; paga: boolean; boletoGerado: boolean; etapa: string | null; elegivelHoje: boolean };
type TemplateInfo = { name: string; found: boolean; status: string | null; bodyParamCount: number | null; hasUrlButton: boolean; urlButtonHasVariable: boolean; error?: string };
type Preflight = { gate: { provider: "evolution" | "meta"; appMode: string; outboundEnabled: boolean; dryRun: boolean; allowAllProduction: boolean; allowlistCount: number; credsPresent: boolean }; templates: TemplateInfo[] };
type Inadimplente = { billId: number; installmentId: number; numero: string | null; empreendimento: string; imovel: string; clienteNome: string | null; customerId: number | null; vencimento: string; diasAtraso: number; saldo: number; saldoFmt: string; boletoGerado: boolean };
type Regra = { name: string; dayOffset: number; enabled: boolean; sendHour: number };
type EnvioLog = { etapa: string; vencimento: string; valor: number; status: string; motivo: string | null; boletoSent: boolean; quando: string; telefone: string };
type Regua = { regras: Regra[]; recentes: EnvioLog[] };

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ConsultasPage() {
  const [setup, setSetup] = useState(false);
  const [status, setStatus] = useState<{ customers: PingRes; contracts: PingRes; units: PingRes } | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<{ empreendimento: string; contrato: Contrato } | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [acao, setAcao] = useState<{ tipo: "boleto" | "simular" | "enviar"; instId: number; data: any } | null>(null);
  const [pre, setPre] = useState<Preflight | null>(null);
  const [fone, setFone] = useState("");
  const [tels, setTels] = useState<TelCliente[] | null>(null);
  const [regua, setRegua] = useState<Regua | null>(null);
  const [runResumo, setRunResumo] = useState<any>(null);
  const [rodando, setRodando] = useState(false);
  const [amostra, setAmostra] = useState<Record<string, any[]> | null>(null);
  const [inad, setInad] = useState<Inadimplente[] | null>(null);
  const [carregandoInad, setCarregandoInad] = useState(false);
  const [selInad, setSelInad] = useState<Set<string>>(new Set());
  const [enviandoInad, setEnviandoInad] = useState(false);
  const [resInad, setResInad] = useState<any>(null);
  const [revisao, setRevisao] = useState<any>(null);
  const [revisando, setRevisando] = useState(false);
  const [filtroEmpreend, setFiltroEmpreend] = useState("");

  useEffect(() => {
    const isSetup = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("setup");
    setSetup(isSetup);
    carregarInadimplentes(); // tela do operador: sempre
    if (isSetup) {
      (async () => {
        try {
          const [s, e, pf, rg] = await Promise.all([
            fetch("/api/consultas/sienge?action=status").then(r => r.json()),
            fetch("/api/consultas/sienge?action=empreendimentos").then(r => r.json()),
            fetch("/api/consultas/sienge?action=preflight").then(r => r.json()).catch(() => null),
            fetch("/api/consultas/sienge?action=regua").then(r => r.json()).catch(() => null),
          ]);
          if (s?.ok) setStatus(s.status);
          if (pf?.ok) setPre({ gate: pf.gate, templates: pf.templates });
          if (rg?.ok) setRegua({ regras: rg.regras, recentes: rg.recentes });
          if (e?.ok) setGrupos(e.empreendimentos);
          fetch("/api/consultas/sienge?action=amostra-cliente").then(r => r.json()).then(d => { if (d?.ok) setAmostra(d.valores); }).catch(() => {});
        } catch (err: any) { setErro(String(err?.message ?? err)); }
      })();
    }
  }, []);

  const envioLiberado = !!pre && pre.gate.outboundEnabled && !pre.gate.dryRun && pre.gate.credsPresent;

  async function recarregarRegua() {
    const rg = await fetch("/api/consultas/sienge?action=regua").then(r => r.json()).catch(() => null);
    if (rg?.ok) setRegua({ regras: rg.regras, recentes: rg.recentes });
  }
  async function toggleRegua(name: string, enabled: boolean) {
    await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regua-toggle", name, enabled }) });
    recarregarRegua();
  }
  async function rodarRegua() {
    if (!confirm("Rodar a régua agora?\n\nVai varrer os contratos no Sienge e disparar as etapas ativas das parcelas em aberto.")) return;
    setRodando(true); setRunResumo(null);
    const d = await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regua-rodar" }) }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    setRunResumo(d.ok ? d.resumo : { erro: d.detail || d.error });
    setRodando(false); recarregarRegua();
  }

  const chaveInad = (i: Inadimplente) => `${i.billId}:${i.installmentId}`;
  async function carregarInadimplentes() {
    setCarregandoInad(true); setResInad(null); setRevisao(null);
    try {
      const d = await fetch("/api/consultas/sienge?action=inadimplentes").then(r => r.json());
      if (d?.ok) { setInad(d.itens); setSelInad(new Set()); }
      else setErro(d?.detail || d?.error || "falha ao listar inadimplentes");
    } catch (e: any) { setErro(String(e?.message ?? e)); }
    finally { setCarregandoInad(false); }
  }
  function toggleSel(k: string) { setSelInad(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); }
  function selecionarTodos(lista: Inadimplente[]) {
    const keys = lista.map(chaveInad);
    setSelInad(s => { const todos = keys.every(k => s.has(k)); const n = new Set(s); keys.forEach(k => todos ? n.delete(k) : n.add(k)); return n; });
  }
  const itensSelecionados = () => (inad ?? []).filter(i => selInad.has(chaveInad(i)))
    .map(i => ({ billId: i.billId, installmentId: i.installmentId, customerId: i.customerId, nome: i.clienteNome, imovel: i.imovel }));

  // Passo 1: revisar (não envia) — mostra quem receberia + a mensagem exata.
  async function revisarSelecao() {
    const itens = itensSelecionados();
    if (!itens.length) { alert("Marque pelo menos um inadimplente."); return; }
    setRevisando(true); setResInad(null); setRevisao(null);
    const d = await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prever-lembretes", itens }) }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    setRevisao(d.ok ? d : { erro: d.detail || d.error });
    setRevisando(false);
  }

  // Passo 2: o ÚLTIMO comando é seu — confirma e envia de verdade.
  async function confirmarEnvio() {
    const itens = itensSelecionados();
    if (!itens.length) return;
    setEnviandoInad(true); setResInad(null);
    const d = await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "enviar-lembretes", itens }) }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    setResInad(d.ok ? d : { erro: d.detail || d.error });
    setEnviandoInad(false); setRevisao(null);
    carregarInadimplentes();
  }
  const statusTag = (s: string) => {
    const cor = s === "SENT" ? { background: "#0b3d1e", color: "#fff" } : undefined;
    const cls = s === "SENT" ? "tag" : s === "DRY_RUN" ? "tag neu" : "tag off";
    return <span className={cls} style={cor}>{s}</span>;
  };

  async function enviarReal(p: Parcela) {
    const c = aberto!.contrato;
    const imovel = `${aberto!.empreendimento}${c.unidades.length ? " — " + c.unidades.join(", ") : ""}`;
    const nome = c.clientes[0]?.nome ?? "cliente";
    const num = fone.trim();
    if (!num) { alert("Informe o número do WhatsApp (com DDD) antes de enviar."); return; }
    if (!confirm(`ENVIO REAL de WhatsApp para ${num}\nCliente: ${nome}\nParcela: ${p.installmentId} · ${p.vencimento} · ${p.saldoFmt}\n\nConfirmar envio?`)) return;
    setAcao({ tipo: "enviar", instId: p.installmentId, data: "loading" });
    const d = await fetch("/api/consultas/sienge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enviar", billId: c.receivableBillId, installmentId: p.installmentId, nome, imovel, etapa: p.etapa ?? "D0", to: num }),
    }).then(r => r.json());
    setAcao({ tipo: "enviar", instId: p.installmentId, data: d });
  }

  async function abrirParcelas(empreendimento: string, contrato: Contrato) {
    setAberto({ empreendimento, contrato }); setParcelas(null); setAcao(null); setFone(""); setTels(null);
    const ids = contrato.clientes.map(c => c.customerId).filter((n): n is number => !!n);
    if (ids.length) {
      fetch(`/api/consultas/sienge?action=telefones&customerIds=${ids.join(",")}`).then(r => r.json())
        .then(d => { if (d?.ok) { setTels(d.clientes); const primeiro = d.clientes.flatMap((c: TelCliente) => c.telefones)[0]; if (primeiro) setFone(primeiro.numero); } })
        .catch(() => setTels([]));
    } else { setTels([]); }
    if (!contrato.receivableBillId) { setParcelas([]); return; }
    try {
      const d = await fetch(`/api/consultas/sienge?action=parcelas&billId=${contrato.receivableBillId}`).then(r => r.json());
      setParcelas(d.ok ? d.parcelas : []);
      if (!d.ok) setErro(d.detail || d.error);
    } catch (e: any) { setErro(String(e?.message ?? e)); setParcelas([]); }
  }

  async function verBoleto(instId: number) {
    setAcao({ tipo: "boleto", instId, data: "loading" });
    const billId = aberto!.contrato.receivableBillId;
    const d = await fetch(`/api/consultas/sienge?action=boleto&billId=${billId}&installmentId=${instId}`).then(r => r.json());
    setAcao({ tipo: "boleto", instId, data: d });
  }

  async function simular(p: Parcela) {
    setAcao({ tipo: "simular", instId: p.installmentId, data: "loading" });
    const c = aberto!.contrato;
    const imovel = `${aberto!.empreendimento}${c.unidades.length ? " — " + c.unidades.join(", ") : ""}`;
    const nome = c.clientes[0]?.nome ?? "cliente";
    const d = await fetch("/api/consultas/sienge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simular", billId: c.receivableBillId, installmentId: p.installmentId, nome, imovel, etapa: p.etapa ?? "D0" }),
    }).then(r => r.json());
    setAcao({ tipo: "simular", instId: p.installmentId, data: d });
  }

  const chip = (label: string, p?: PingRes) => <span className={p?.ok ? "pill on" : "pill off"} style={{ marginRight: 8 }}>{label}: {p ? (p.ok ? p.count ?? "?" : `HTTP ${p.httpStatus}`) : "…"}</span>;
  const etapaTag = (e: string | null) => e ? <span className={`tag ${e === "D+1" ? "off" : "on"}`}>{e === "D-10" ? "10 dias antes" : e === "D0" ? "vence hoje" : "atrasada (D+1)"}</span> : <span className="tag neu">—</span>;
  const check = (label: string, ok: boolean, extra?: string) => <span className={`pill ${ok ? "on" : "off"}`}>{ok ? "✅" : "⛔"} {label}{extra ? ` · ${extra}` : ""}</span>;

  const termo = busca.trim().toLowerCase();
  const filtrados = (grupos ?? []).map(g => ({ ...g, contratos: termo ? g.contratos.filter(c => (c.numero ?? "").toLowerCase().includes(termo) || c.clientes.some(cl => (cl.nome ?? "").toLowerCase().includes(termo)) || c.unidades.some(u => u.toLowerCase().includes(termo)) || g.empreendimento.toLowerCase().includes(termo)) : g.contratos })).filter(g => g.contratos.length);

  // Inadimplentes: opções de filtro + lista filtrada por empreendimento.
  const empreendimentos = [...new Set((inad ?? []).map(i => i.empreendimento).filter(Boolean))].sort();
  const inadFiltrado = (inad ?? []).filter(i => !filtroEmpreend || i.empreendimento === filtroEmpreend);
  const totalFiltrado = inadFiltrado.reduce((s, i) => s + (i.saldo || 0), 0);

  return (
    <main>
      <header>
        <div><small>CASA FORTE · COBRANÇA</small><h1>Inadimplentes</h1></div>
        <button className="ghost" disabled={carregandoInad} onClick={carregarInadimplentes}>{carregandoInad ? "Atualizando…" : "Atualizar"}</button>
      </header>

      {erro && <section className="panel"><p style={{ color: "#8d1c0f" }}>{erro}</p></section>}

      {/* ===================== TELA DO OPERADOR: INADIMPLENTES ===================== */}
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Cobrança por inadimplência</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {empreendimentos.length > 0 && (
              <select value={filtroEmpreend} onChange={e => setFiltroEmpreend(e.target.value)}>
                <option value="">Todos os empreendimentos</option>
                {empreendimentos.map(emp => <option key={emp} value={emp}>{emp}</option>)}
              </select>
            )}
            {selInad.size > 0 && <button className="ghost" disabled={revisando} style={{ borderColor: "#8d1c0f", color: "#8d1c0f" }} onClick={revisarSelecao}>{revisando ? "Preparando…" : `Revisar seleção (${selInad.size})`}</button>}
          </div>
        </div>

        {carregandoInad && !inad ? (
          <p style={{ marginTop: 12 }}>Buscando inadimplentes no Sienge…</p>
        ) : !inad ? (
          <p className="note" style={{ marginTop: 12 }}>—</p>
        ) : inadFiltrado.length === 0 ? (
          <p className="note" style={{ marginTop: 12 }}>{inad.length === 0 ? "🎉 Nenhuma parcela vencida em aberto." : "Nenhum inadimplente neste empreendimento."}</p>
        ) : (
          <>
            <p className="note" style={{ marginTop: 8 }}>
              {inadFiltrado.length} parcela(s) em atraso{filtroEmpreend ? ` em ${filtroEmpreend}` : ""} · total {brl(totalFiltrado)} · {selInad.size} marcada(s). Marque quem quer cobrar, clique <strong>Revisar seleção</strong> e confirme.
            </p>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table>
                <thead><tr>
                  <th><input type="checkbox" checked={inadFiltrado.every(i => selInad.has(chaveInad(i))) && inadFiltrado.length > 0} onChange={() => selecionarTodos(inadFiltrado)} /></th>
                  <th>Cliente</th><th>Empreendimento / unidade</th><th>Contrato</th><th>Vencimento</th><th>Atraso</th><th style={{ textAlign: "right" }}>Saldo</th><th>Boleto</th>
                </tr></thead>
                <tbody>
                  {inadFiltrado.map((i) => {
                    const k = chaveInad(i);
                    return (
                      <tr key={k} style={{ background: selInad.has(k) ? "#f0f6f0" : undefined, cursor: "pointer" }} onClick={() => toggleSel(k)}>
                        <td><input type="checkbox" checked={selInad.has(k)} onChange={() => toggleSel(k)} onClick={e => e.stopPropagation()} /></td>
                        <td>{i.clienteNome ?? "—"}</td>
                        <td>{i.imovel}</td>
                        <td>{i.numero}</td>
                        <td>{i.vencimento}</td>
                        <td><span className="tag off">{i.diasAtraso} dia(s)</span></td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i.saldoFmt}</td>
                        <td>{i.boletoGerado ? "✅" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {revisao && (
          <div style={{ marginTop: 14, borderTop: "2px solid #8d1c0f", paddingTop: 12 }}>
            {revisao.erro ? <p style={{ color: "#8d1c0f" }}>{revisao.erro}</p> : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0 }}>Revisão — confira antes de enviar</h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="ghost" onClick={() => setRevisao(null)}>Cancelar</button>
                    <button className="ghost" disabled={enviandoInad || revisao.enviaraveis === 0} style={{ background: "#8d1c0f", color: "#fff", borderColor: "#8d1c0f" }} onClick={confirmarEnvio}>{enviandoInad ? "Enviando…" : `Confirmar e ENVIAR (${revisao.enviaraveis})`}</button>
                  </div>
                </div>
                <p className="note">{revisao.enviaraveis} de {revisao.total} serão enviados de verdade — o resto está retido (dry-run/master switch, sem telefone ou já pago). Confira <strong>nome e telefone</strong> de cada um.</p>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr><th>Cliente</th><th>Telefone</th><th>Imóvel</th><th>Vencimento</th><th style={{ textAlign: "right" }}>Saldo</th><th>Situação</th></tr></thead>
                    <tbody>
                      {revisao.previews.map((p: any, i: number) => (
                        <tr key={i} style={{ opacity: p.enviaria ? 1 : 0.55 }}>
                          <td>{p.nome ?? "—"}</td>
                          <td style={{ fontFamily: "monospace" }}>{p.telefone ?? "—"}</td>
                          <td>{p.imovel ?? "—"}</td>
                          <td>{p.vencimento ?? "—"}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.saldoFmt ?? "—"}</td>
                          <td>{p.enviaria ? <span className="tag" style={{ background: "#0b3d1e", color: "#fff" }}>✅ será enviado</span> : <span className="tag off">⛔ {p.motivo}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {revisao.previews.some((p: any) => p.enviaria) && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="note" style={{ cursor: "pointer" }}>Ver a mensagem que será enviada</summary>
                    <div className="payload" style={{ whiteSpace: "pre-wrap", background: "#0b3d1e", marginTop: 6 }}>{revisao.previews.find((p: any) => p.enviaria)?.mensagem}</div>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {resInad && (
          <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
            {resInad.erro ? <p style={{ color: "#8d1c0f" }}>{resInad.erro}</p> : (
              <>
                <p style={{ margin: 0 }}><strong>Resultado:</strong> {Object.entries(resInad.contagem ?? {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"} (de {resInad.total})</p>
                <p className="note" style={{ marginBottom: 0 }}>SENT = enviado · DRY_RUN = retido pelas travas · PAGA = já quitada · NO_PHONE = sem telefone no Sienge.</p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ===================== FERRAMENTAS DE CONFIGURAÇÃO (?setup=1) ===================== */}
      {setup && (
        <>
          <section className="panel">
            <p style={{ margin: 0 }}>{chip("Clientes", status?.customers)}{chip("Contratos", status?.contracts)}{chip("Unidades", status?.units)}</p>
            <p className="note" style={{ marginBottom: 0 }}>Modo setup · {envioLiberado ? <strong style={{ color: "#8d1c0f" }}>ENVIO REAL LIGADO</strong> : <>envios em <strong>dry-run</strong></>}.</p>
          </section>

          {pre && (
            <section className="panel">
              <h2 style={{ marginTop: 0, marginBottom: 8 }}>Prontidão do envio real <span className="tag neu">canal: {pre.gate.provider === "evolution" ? "Evolution" : "Meta oficial"}</span></h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {check("Master switch (outbound)", pre.gate.outboundEnabled)}
                {check("Dry-run desligado", !pre.gate.dryRun)}
                {check(pre.gate.provider === "evolution" ? "Credenciais Evolution" : "Credenciais Meta", pre.gate.credsPresent)}
              </div>
            </section>
          )}

          {amostra && (
            <section className="panel">
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Cadastro automático de cliente no Sienge — códigos detectados</h2>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Variável (Railway)</th><th>Campo Sienge</th><th>Valores detectados</th></tr></thead>
                  <tbody>
                    <tr><td>SIENGE_PERSON_TYPE_FISICA</td><td>personType</td><td>{(amostra.personType ?? []).join(", ") || "—"}</td></tr>
                    <tr><td>SIENGE_CUSTOMER_TYPE_ID</td><td>typeId</td><td>{(amostra.typeId ?? []).join(", ") || "—"}</td></tr>
                    <tr><td>SIENGE_DEFAULT_SEX</td><td>sex</td><td>{(amostra.sex ?? []).join(", ") || "—"}</td></tr>
                    <tr><td>SIENGE_DEFAULT_MAILING</td><td>mailingAddress</td><td>{(amostra.mailingAddress ?? []).join(", ") || "—"}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {regua && (
            <section className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Régua de cobrança (automática)</h2>
                <button className="ghost" disabled={rodando} onClick={rodarRegua}>{rodando ? "Rodando…" : "Rodar régua agora"}</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {regua.regras.map(r => (
                  <button key={r.name} className={`pill ${r.enabled ? "on" : "off"}`} onClick={() => toggleRegua(r.name, !r.enabled)}>
                    {r.enabled ? "✅" : "⛔"} {r.name} ({r.name === "D-10" ? "10 dias antes" : r.name === "D0" ? "vence hoje" : "atraso 1 dia"})
                  </button>
                ))}
                <span className="note">clique pra ligar/desligar</span>
              </div>
              {runResumo && (
                <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
                  {runResumo.erro ? <p style={{ color: "#8d1c0f" }}>{runResumo.erro}</p> : (
                    <p style={{ margin: 0 }}><strong>Resultado:</strong> {runResumo.enviados} enviado(s) · {runResumo.dryRun} dry-run · {runResumo.bloqueados} bloqueado(s) · {runResumo.semTelefone} sem telefone · {runResumo.jaEnviados} já enviados · {runResumo.erros} erro(s){runResumo.skipped ? ` · (${runResumo.skipped})` : ""} — de {runResumo.contratos} contrato(s), {runResumo.elegiveis} elegível(is) hoje.</p>
                  )}
                </div>
              )}
              {regua.recentes.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table>
                    <thead><tr><th>Quando</th><th>Etapa</th><th>Vencimento</th><th style={{ textAlign: "right" }}>Valor</th><th>Telefone</th><th>Status</th></tr></thead>
                    <tbody>
                      {regua.recentes.map((s, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: "nowrap" }}>{new Date(s.quando).toLocaleString("pt-BR", { timeZone: "America/Maceio" })}</td>
                          <td>{s.etapa}</td><td>{s.vencimento}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(s.valor)}</td>
                          <td>{s.telefone}</td>
                          <td>{statusTag(s.status)}{s.motivo ? <span className="note"> {s.motivo}</span> : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grupos && (
            <>
              <section className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Clientes por empreendimento</h2>
                <input placeholder="Buscar cliente, contrato ou unidade…" value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 260 }} />
              </section>
              {filtrados.map(g => (
                <section className="panel" key={g.empreendimento}>
                  <h2 style={{ marginBottom: 4 }}>{g.empreendimento}</h2><span className="note">{g.contratos.length} contrato(s)</span>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table>
                      <thead><tr><th>Contrato</th><th>Cliente(s)</th><th>Unidade(s)</th><th>Situação</th><th style={{ textAlign: "right" }}>Valor</th><th></th></tr></thead>
                      <tbody>
                        {g.contratos.map(c => (
                          <tr key={c.contratoId ?? c.numero}>
                            <td><strong>{c.numero ?? c.contratoId}</strong></td>
                            <td>{c.clientes.map((cl, i) => <div key={i}>{cl.nome}{cl.principal ? "" : cl.conjuge ? " (cônjuge)" : ""}</div>)}</td>
                            <td>{c.unidades.join(", ") || "—"}</td>
                            <td><span className={`tag ${/cancel/i.test(c.situacao ?? "") ? "off" : "on"}`}>{c.situacao ?? "—"}</span></td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(c.valor)}</td>
                            <td>{c.receivableBillId ? <button className="ghost" onClick={() => abrirParcelas(g.empreendimento, c)}>Parcelas & boletos</button> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}

          {aberto && (
            <section className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Parcelas — contrato {aberto.contrato.numero ?? aberto.contrato.contratoId}</h2>
                <button className="ghost" onClick={() => { setAberto(null); setParcelas(null); setAcao(null); }}>Fechar</button>
              </div>
              <span className="note">{aberto.contrato.clientes.map(c => c.nome).join(", ")} · {aberto.empreendimento}{aberto.contrato.unidades.length ? " — " + aberto.contrato.unidades.join(", ") : ""}</span>

              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input placeholder="WhatsApp do cliente (ex.: +5582999999999)" value={fone} onChange={e => setFone(e.target.value)} style={{ minWidth: 260 }} />
              </div>
              <div style={{ marginTop: 6 }}>
                {tels === null ? <span className="note">Buscando telefones no Sienge…</span>
                  : tels.flatMap(c => c.telefones).length === 0 ? <span className="note">Nenhum telefone no cadastro do Sienge — digite manualmente.</span>
                  : <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="note">Telefones do Sienge:</span>
                      {tels.flatMap(c => c.telefones).map((t, i) => (
                        <button key={i} className="ghost" onClick={() => setFone(t.numero)} style={fone === t.numero ? { borderColor: "#0b3d1e", color: "#0b3d1e" } : undefined}>
                          {t.numero}{t.tipo ? ` · ${t.tipo}` : ""}{t.principal ? " ★" : ""}
                        </button>
                      ))}
                    </span>}
              </div>

              {!parcelas ? <p style={{ marginTop: 12 }}>Carregando parcelas…</p> : parcelas.length === 0 ? <p className="note" style={{ marginTop: 12 }}>Sem parcelas.</p> : (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table>
                    <thead><tr><th>Parc.</th><th>Vencimento</th><th style={{ textAlign: "right" }}>Saldo</th><th>Boleto</th><th>Régua hoje</th><th></th></tr></thead>
                    <tbody>
                      {parcelas.map(p => (
                        <tr key={p.installmentId} style={{ opacity: p.paga ? 0.5 : 1 }}>
                          <td>{p.installmentId}</td>
                          <td>{p.vencimento}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.paga ? "paga" : p.saldoFmt}</td>
                          <td>{p.boletoGerado ? "✅ gerado" : "—"}</td>
                          <td>{p.paga ? <span className="tag neu">—</span> : etapaTag(p.etapa)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {p.boletoGerado && <button className="ghost" onClick={() => verBoleto(p.installmentId)}>Boleto</button>}{" "}
                            {!p.paga && <button className="ghost" onClick={() => simular(p)}>Simular</button>}{" "}
                            {!p.paga && <button className="ghost" onClick={() => enviarReal(p)}>Enviar de verdade</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {acao && (
                <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 14 }}>
                  {acao.data === "loading" ? <p>Consultando…</p> : acao.tipo === "boleto" ? (
                    acao.data?.ok ? (
                      <div>
                        <h3 style={{ marginTop: 0 }}>Boleto — parcela {acao.instId}</h3>
                        {acao.data.boleto?.url ? <p><a href={acao.data.boleto.url} target="_blank" rel="noreferrer">Abrir boleto (PDF)</a></p> : <p className="note">Sem link de boleto.</p>}
                        {acao.data.boleto?.linhaDigitavel && <p style={{ fontFamily: "monospace", background: "#f0f0ec", padding: "8px 10px", borderRadius: 8 }}>{acao.data.boleto.linhaDigitavel}</p>}
                      </div>
                    ) : <p style={{ color: "#8d1c0f" }}>{acao.data?.detail || acao.data?.error}</p>
                  ) : acao.tipo === "enviar" ? (
                    acao.data?.ok ? (
                      <div>
                        <h3 style={{ marginTop: 0 }}>Envio — parcela {acao.instId}{" "}
                          {acao.data.enviado ? <span className="tag" style={{ background: "#0b3d1e", color: "#fff" }}>✅ ENVIADA</span> : <span className="tag off">🔒 NÃO ENVIADA ({acao.data.motivo})</span>}
                        </h3>
                        {acao.data.enviado ? <p className="note">Via {acao.data.provider} · message id: {acao.data.messageId ?? "—"} · Boleto PDF: {acao.data.boletoEnviado ? "enviado" : "link no texto"}.</p>
                          : <div className="payload" style={{ whiteSpace: "pre-wrap", background: "#0b3d1e" }}>{acao.data.preview}</div>}
                      </div>
                    ) : <p style={{ color: "#8d1c0f" }}>{acao.data?.detail || acao.data?.error}</p>
                  ) : (
                    acao.data?.ok ? (
                      <div>
                        <h3 style={{ marginTop: 0 }}>Simulação — parcela {acao.instId} <span className="tag off">🔒 NÃO ENVIADO ({acao.data.motivo})</span></h3>
                        <div className="payload" style={{ whiteSpace: "pre-wrap", background: "#0b3d1e" }}>{acao.data.preview}{acao.data.boleto?.url ? `\n\nBoleto: ${acao.data.boleto.url}` : ""}{acao.data.boleto?.linhaDigitavel ? `\nLinha digitável: ${acao.data.boleto.linhaDigitavel}` : ""}</div>
                      </div>
                    ) : <p style={{ color: "#8d1c0f" }}>{acao.data?.detail || acao.data?.error}</p>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
