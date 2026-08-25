"use client";
import { useEffect, useState } from "react";

// Consultas do Sienge (staging). READ-ONLY, PII redigida, atrás do Basic Auth.
// Clientes por empreendimento → parcelas de um contrato → boleto + simulação
// de cobrança (dry-run: mostra a mensagem que SERIA enviada, sem enviar).

type PingRes = { ok: boolean; httpStatus: number; count: number | null };
type Cliente = { nome: string | null; customerId: number | null; principal: boolean; conjuge: boolean };
type TelCliente = { customerId: number; nome: string | null; telefones: { numero: string; tipo: string | null; principal: boolean }[] };
type Contrato = { contratoId: number | null; numero: string | null; situacao: string | null; valor: number | null; receivableBillId: number | null; clientes: Cliente[]; unidades: string[] };
type Grupo = { empreendimento: string; contratos: Contrato[] };
type Parcela = { installmentId: number; vencimento: string; saldo: number; saldoFmt: string; paga: boolean; boletoGerado: boolean; etapa: string | null; elegivelHoje: boolean };
type TemplateInfo = { name: string; found: boolean; status: string | null; bodyParamCount: number | null; hasUrlButton: boolean; urlButtonHasVariable: boolean; error?: string };
type Preflight = { gate: { provider: "evolution" | "meta"; appMode: string; outboundEnabled: boolean; dryRun: boolean; allowAllProduction: boolean; allowlistCount: number; credsPresent: boolean }; templates: TemplateInfo[] };
type Regra = { name: string; dayOffset: number; enabled: boolean; sendHour: number };
type EnvioLog = { etapa: string; vencimento: string; valor: number; status: string; motivo: string | null; boletoSent: boolean; quando: string; telefone: string };
type Regua = { regras: Regra[]; recentes: EnvioLog[] };

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ConsultasPage() {
  const [status, setStatus] = useState<{ customers: PingRes; contracts: PingRes; units: PingRes } | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
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
        if (!e?.ok) throw new Error(e?.detail || e?.error || "falha ao carregar");
        setGrupos(e.empreendimentos);
      } catch (err: any) { setErro(String(err?.message ?? err)); }
      finally { setLoading(false); }
    })();
  }, []);

  const envioLiberado = !!pre && pre.gate.outboundEnabled && !pre.gate.dryRun && pre.gate.credsPresent && pre.gate.allowlistCount > 0;

  async function recarregarRegua() {
    const rg = await fetch("/api/consultas/sienge?action=regua").then(r => r.json()).catch(() => null);
    if (rg?.ok) setRegua({ regras: rg.regras, recentes: rg.recentes });
  }
  async function toggleRegua(name: string, enabled: boolean) {
    await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regua-toggle", name, enabled }) });
    recarregarRegua();
  }
  async function rodarRegua() {
    if (!confirm("Rodar a régua agora?\n\nVai varrer os contratos no Sienge e disparar as etapas de hoje (D-10/D0/D+1) das parcelas em aberto.\nSó envia de verdade para números na allowlist — o resto fica registrado como bloqueado/dry-run.")) return;
    setRodando(true); setRunResumo(null);
    const d = await fetch("/api/consultas/sienge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regua-rodar" }) }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    setRunResumo(d.ok ? d.resumo : { erro: d.detail || d.error });
    setRodando(false); recarregarRegua();
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
    // Telefones do cadastro do cliente no Sienge (sob demanda).
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

  return (
    <main>
      <header><div><small>CASA FORTE · STAGING</small><h1>Consultas & Cobrança</h1></div><a href="/" style={{ fontSize: 14 }}>← Dashboard</a></header>

      <section className="panel">
        <p style={{ margin: 0 }}>{chip("Clientes", status?.customers)}{chip("Contratos", status?.contracts)}{chip("Unidades", status?.units)}</p>
        <p className="note" style={{ marginBottom: 0 }}>Somente leitura · CPF/e-mail/telefone mascarados · {envioLiberado ? <strong style={{ color: "#8d1c0f" }}>ENVIO REAL LIBERADO (só allowlist)</strong> : <>envios em <strong>dry-run</strong> (nada é enviado)</>}.</p>
      </section>

      {pre && (
        <section className="panel">
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Prontidão do envio real <span className="tag neu">canal: {pre.gate.provider === "evolution" ? "Evolution" : "Meta oficial"}</span></h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {check("Master switch (outbound)", pre.gate.outboundEnabled)}
            {check("Dry-run desligado", !pre.gate.dryRun)}
            {check(pre.gate.provider === "evolution" ? "Credenciais Evolution" : "Credenciais Meta", pre.gate.credsPresent)}
            {check(`Allowlist (${pre.gate.allowlistCount})`, pre.gate.allowlistCount > 0)}
          </div>
          {pre.gate.provider === "meta" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {pre.templates.map(t => check(`${t.name}`, t.status === "APPROVED", t.error ? t.error : t.status ?? "não encontrado"))}
            </div>
          )}
          <p className="note" style={{ marginBottom: 0 }}>
            {pre.gate.provider === "evolution" ? "Via Evolution (texto livre + boleto), sem template. " : ""}
            {envioLiberado
              ? "Travas liberadas: o botão “Enviar de verdade” manda WhatsApp real — só para números na allowlist."
              : "Enquanto algum item estiver vermelho, “Enviar de verdade” cai em dry-run ou é bloqueado. Ajuste no Railway."}
          </p>
        </section>
      )}

      {erro && <section className="panel"><p style={{ color: "#8d1c0f" }}>{erro}</p><p className="note">Se aparecer "painel_sem_senha", defina DASHBOARD_BASIC_USER/PASS no Railway.</p></section>}
      {loading && <section className="panel"><p>Carregando do Sienge…</p></section>}

      {regua && (
        <section className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Régua de cobrança (automática)</h2>
            <button className="ghost" disabled={rodando} onClick={rodarRegua} style={envioLiberado ? { borderColor: "#8d1c0f", color: "#8d1c0f" } : undefined}>{rodando ? "Rodando…" : "Rodar régua agora"}</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {regua.regras.map(r => (
              <button key={r.name} className={`pill ${r.enabled ? "on" : "off"}`} onClick={() => toggleRegua(r.name, !r.enabled)}>
                {r.enabled ? "✅" : "⛔"} {r.name} ({r.name === "D-10" ? "10 dias antes" : r.name === "D0" ? "vence hoje" : "atraso 1 dia"})
              </button>
            ))}
            <span className="note">clique pra ligar/desligar cada etapa</span>
          </div>
          <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
            Roda 1×/dia (cron). Dispara as etapas ativas das parcelas em aberto, lendo direto do Sienge. As travas de envio valem igual: fora da allowlist, fica registrado sem enviar.
          </p>

          {runResumo && (
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
              {runResumo.erro ? <p style={{ color: "#8d1c0f" }}>{runResumo.erro}</p> : (
                <p style={{ margin: 0 }}>
                  <strong>Resultado:</strong> {runResumo.enviados} enviado(s) · {runResumo.dryRun} dry-run · {runResumo.bloqueados} bloqueado(s) · {runResumo.semTelefone} sem telefone · {runResumo.jaEnviados} já enviados · {runResumo.erros} erro(s)
                  {runResumo.skipped ? ` · (${runResumo.skipped})` : ""} — de {runResumo.contratos} contrato(s), {runResumo.elegiveis} parcela(s) elegível(is) hoje.
                </p>
              )}
            </div>
          )}

          {regua.recentes.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table>
                <thead><tr><th>Quando</th><th>Etapa</th><th>Vencimento</th><th style={{ textAlign: "right" }}>Valor</th><th>Telefone</th><th>Status</th><th>Boleto</th></tr></thead>
                <tbody>
                  {regua.recentes.map((s, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(s.quando).toLocaleString("pt-BR", { timeZone: "America/Maceio" })}</td>
                      <td>{s.etapa}</td>
                      <td>{s.vencimento}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(s.valor)}</td>
                      <td>{s.telefone}</td>
                      <td>{statusTag(s.status)}{s.motivo ? <span className="note"> {s.motivo}</span> : ""}</td>
                      <td>{s.status === "SENT" ? (s.boletoSent ? "PDF ✅" : "link") : "—"}</td>
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
            <span className={`tag ${envioLiberado ? "off" : "neu"}`}>{envioLiberado ? "envio real ligado" : "dry-run"}</span>
            <span className="note">O número precisa estar na WHATSAPP_ALLOWLIST do Railway.</span>
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
                        {!p.paga && <button className="ghost" style={envioLiberado ? { borderColor: "#8d1c0f", color: "#8d1c0f" } : undefined} onClick={() => enviarReal(p)}>Enviar de verdade</button>}
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
                      {acao.data.enviado
                        ? <span className="tag" style={{ background: "#0b3d1e", color: "#fff" }}>✅ ENVIADA</span>
                        : <span className="tag off">🔒 NÃO ENVIADA ({acao.data.motivo})</span>}
                    </h3>
                    {acao.data.enviado ? (
                      acao.data.provider === "evolution" ? (
                        <>
                          <p className="note">Enviado via Evolution · message id: {acao.data.messageId ?? "—"}</p>
                          <p className="note" style={{ marginBottom: 0 }}>Boleto (PDF): {acao.data.boletoEnviado ? "enviado como documento" : "não enviado como PDF — o link e a linha digitável vão no texto"}.</p>
                        </>
                      ) : (
                        <>
                          <p className="note">Template: {acao.data.template} ({acao.data.templateStatus ?? "?"}) · message id: {acao.data.messageId}</p>
                          <p className="note" style={{ marginBottom: 0 }}>Boleto no template: {acao.data.boletoNoTemplate ? "sim (botão de link)" : "não — enviar boleto à parte se necessário"}.</p>
                        </>
                      )
                    ) : (
                      <>
                        <p className="note">A trava de segurança segurou o envio ({acao.data.motivo}). Ajuste as variáveis no Railway para liberar.</p>
                        <div className="payload" style={{ whiteSpace: "pre-wrap", background: "#0b3d1e" }}>{acao.data.preview}</div>
                      </>
                    )}
                  </div>
                ) : <p style={{ color: "#8d1c0f" }}>{(acao.data?.error === "template_nao_aprovado" ? "Template não aprovado na Meta: " : acao.data?.error === "bloqueado_seguranca" ? "Bloqueado pela allowlist: " : acao.data?.error === "credenciais_incompletas" ? "Credenciais Meta incompletas: " : acao.data?.error === "meta_erro" ? "Erro da Meta: " : "") + (acao.data?.detail || acao.data?.error)}</p>
              ) : (
                acao.data?.ok ? (
                  <div>
                    <h3 style={{ marginTop: 0 }}>Simulação de cobrança — parcela {acao.instId} <span className="tag off">🔒 NÃO ENVIADO ({acao.data.motivo})</span></h3>
                    <p className="note">Template: {acao.data.template}</p>
                    <div className="payload" style={{ whiteSpace: "pre-wrap", background: "#0b3d1e" }}>{acao.data.preview}{acao.data.boleto?.url ? `\n\nBoleto: ${acao.data.boleto.url}` : ""}{acao.data.boleto?.linhaDigitavel ? `\nLinha digitável: ${acao.data.boleto.linhaDigitavel}` : ""}</div>
                    <p className="note">Isto é o que seria enviado no WhatsApp. Envio real só após aprovar templates na Meta e liberar as travas.</p>
                  </div>
                ) : <p style={{ color: "#8d1c0f" }}>{acao.data?.detail || acao.data?.error}</p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
