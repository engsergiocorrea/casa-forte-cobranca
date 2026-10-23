"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

// Painel do financeiro (cobranca.casaforteinc.com.br). Abas: Hoje, Clientes,
// Inadimplência, Pausas, Régua, Histórico. Todo envio passa por PRÉVIA →
// CONFIRMAR (o último comando é da pessoa). Os dados vêm de /api/painel/*.

type Aba = "hoje" | "clientes" | "inadimplencia" | "pausas" | "regua" | "historico";
type TipoEnvio = "BOLETO" | "LEMBRETE_D0" | "COBRANCA";

const brl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const br = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "—");
const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Maceio", dateStyle: "short", timeStyle: "short" }) : "—");
const NOME_TIPO: Record<string, string> = { BOLETO: "Boleto", LEMBRETE_D0: "Lembrete", COBRANCA: "Cobrança", CONFIRMACAO: "Confirmação", RELATORIO_DIA: "Relatório" };
const NOME_ACAO: Record<TipoEnvio, string> = { BOLETO: "Enviar boleto", LEMBRETE_D0: "Enviar lembrete", COBRANCA: "Enviar cobrança" };

function Status({ s, motivo }: { s: string; motivo?: string | null }) {
  const ok = ["ENVIADA", "ENTREGUE", "LIDA", "SENT"].includes(s);
  const er = ["ERRO", "ERROR", "INCERTA", "UNCERTAIN", "SEM_TELEFONE", "NO_PHONE", "SEM_WHATSAPP", "NO_WHATSAPP", "BLOQUEADA", "BLOCKED"].includes(s);
  const rot: Record<string, string> = { ENVIADA: "Enviada", SENT: "Enviada", ENTREGUE: "Entregue", LIDA: "Lida", DRY_RUN: "Teste", PLANEJADA: "Aguardando", ERRO: "Erro", ERROR: "Erro", INCERTA: "Incerta", UNCERTAIN: "Incerta", SEM_TELEFONE: "Sem telefone", NO_PHONE: "Sem telefone", SEM_WHATSAPP: "Sem WhatsApp", NO_WHATSAPP: "Sem WhatsApp", BLOQUEADA: "Bloqueada", BLOCKED: "Bloqueada", ENVIANDO: "Enviando", SENDING: "Enviando" };
  return <span className={`cf-st ${ok ? "ok" : er ? "er" : "al"}`} title={motivo ?? ""}>{rot[s] ?? s}</span>;
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.erro ?? `Erro ${r.status}`);
  return j as T;
}

// ---------- Modal de envio (prévia → confirmar) ----------
type Pedido = { tipo: TipoEnvio; customerId: number; nome?: string; itens: { billId: number; installmentId: number }[] };
function ModalEnvio({ pedidos, onClose }: { pedidos: Pedido[]; onClose: (enviou: boolean) => void }) {
  const [previas, setPrevias] = useState<any[] | null>(null);
  const [res, setRes] = useState<any[] | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    (async () => {
      try { setPrevias(await Promise.all(pedidos.map((p) => api("/api/painel/envio", { method: "POST", body: JSON.stringify({ ...p, acao: "previa" }) })))); }
      catch (e: any) { setErro(e.message); }
    })();
  }, [pedidos]);
  const enviaveis = (previas ?? []).filter((p) => p.prontos?.length && p.telefone);
  async function confirmar() {
    setEnviando(true); const out: any[] = [];
    for (const p of pedidos) {
      const pv = previas?.find((x) => x.customerId === p.customerId);
      if (!pv?.prontos?.length || !pv?.telefone) continue;
      try { out.push(await api("/api/painel/envio", { method: "POST", body: JSON.stringify({ ...p, acao: "enviar" }) })); }
      catch (e: any) { out.push({ customerId: p.customerId, nome: p.nome, status: "ERRO", detalhe: e.message }); }
      setRes([...out]);
    }
    setEnviando(false);
  }
  return <div className="cf-modal" onClick={() => !enviando && onClose(!!res)}>
    <div className="cf-modal-in" onClick={(e) => e.stopPropagation()}>
      <h2>{NOME_ACAO[pedidos[0].tipo]} — {pedidos.length > 1 ? `${pedidos.length} clientes` : (previas?.[0]?.nome || pedidos[0].nome || "cliente")}</h2>
      {erro && <p className="erro">{erro}</p>}
      {!previas && !erro && <p className="muted">Conferindo no Sienge (saldo, boleto e telefone)…</p>}
      {previas && !res && previas.map((p, i) => <div key={i} style={{ marginBottom: 16 }}>
        {pedidos.length > 1 && <h3>{p.nome}</h3>}
        <p className="muted" style={{ margin: "4px 0" }}>WhatsApp: <b>{p.telefone || "— sem celular no Sienge"}</b></p>
        {p.avisos?.map((a: string, k: number) => <div key={k} className="cf-banner teste">{a}</div>)}
        {p.bloqueados?.map((b: any, k: number) => <div key={k} className="cf-banner erro">Parcela {b.installmentId} (título {b.billId}) fora: {b.motivo}</div>)}
        {p.mensagem ? <div className="cf-msg">{p.mensagem}</div> : <p className="erro">Nada a enviar para este cliente.</p>}
      </div>)}
      {res && <div>{res.map((r, i) => <div key={i} className={`cf-banner ${r.enviado ? "ok" : "erro"}`}>{r.nome || "Cliente"}: {r.enviado ? "enviado ✓" : `${r.status}${r.detalhe ? ` — ${r.detalhe}` : ""}`}{r.ignorados?.length ? ` (${r.ignorados.length} já enviado(s) hoje)` : ""}</div>)}</div>}
      <div className="acoes" style={{ marginTop: 14 }}>
        {!res && <button className="bt verm" disabled={!enviaveis.length || enviando} onClick={confirmar}>{enviando ? "Enviando…" : `Confirmar e enviar${enviaveis.length > 1 ? ` (${enviaveis.length})` : ""}`}</button>}
        <button className="bt leve" disabled={enviando} onClick={() => onClose(!!res)}>{res ? "Fechar" : "Cancelar"}</button>
      </div>
    </div>
  </div>;
}

// ---------- Hoje ----------
function Hoje() {
  const [d, setD] = useState<any>(null); const [erro, setErro] = useState(""); const [msg, setMsg] = useState("");
  const carregar = useCallback(() => { api("/api/painel/resumo").then(setD).catch((e) => setErro(e.message)); }, []);
  useEffect(carregar, [carregar]);
  async function enviarRelatorio() {
    if (!confirm("Enviar o relatório de hoje para a diretoria (só quem ainda não recebeu)?")) return;
    const r = await api("/api/painel/relatorio", { method: "POST", body: "{}" }).catch((e) => ({ erro: e.message }));
    setMsg(r.erro ? r.erro : (r.destinatarios ?? []).map((x: any) => `${x.destino}: ${x.status}`).join(" · ") || r.motivo || "ok");
  }
  if (erro) return <div className="cf-banner erro">{erro}</div>;
  if (!d) return <p className="muted">Carregando…</p>;
  const r = d.relatorio, c = d.config;
  return <>
    <h1>Hoje — {br(d.data)}</h1>
    <p className="sub">Tudo o que a comunicação financeira fez hoje e o que precisa de ação.</p>
    {c.reguaTeste ? <div className="cf-banner teste">🧪 A régua automática está em <b>modo de teste</b>: boletos, lembretes e cobranças são só registrados, nenhum cliente recebe. Envios manuais deste painel saem de verdade.</div>
      : <div className="cf-banner ok">Régua automática <b>ligada</b> — {[c.boleto && "boleto", c.lembrete && "lembrete", c.cobranca && "cobrança"].filter(Boolean).join(", ") || "nenhum tipo ligado"}.</div>}
    {!c.envioLigado && <div className="cf-banner erro">Envio de WhatsApp <b>desligado</b> (OUTBOUND_MESSAGING_ENABLED).</div>}
    <div className="cf-cards">
      <div className="cf-card"><b>{r.resumo.boletos}</b><span>Boletos enviados</span></div>
      <div className="cf-card"><b>{r.resumo.lembretes}</b><span>Lembretes</span></div>
      <div className="cf-card"><b>{r.resumo.cobrancas}</b><span>Cobranças</span></div>
      <div className="cf-card"><b>{r.resumo.confirmacoes}</b><span>Confirmações de pagamento</span></div>
      <div className={`cf-card ${r.resumo.falhas ? "alerta" : ""}`}><b>{r.resumo.falhas}</b><span>Falhas</span></div>
      <div className="cf-card"><b>{r.resumo.aguardandoBoleto}</b><span>Aguardando boleto</span></div>
      <div className="cf-card"><b>{r.resumo.emTeste}</b><span>Em teste (só registradas)</span></div>
      <div className="cf-card"><b>{r.resumo.pausas}</b><span>Em pausa</span></div>
    </div>
    <div className="acoes">
      <a className="bt leve" href="/api/painel/relatorio" target="_blank">Ver relatório (PDF)</a>
      <button className="bt" onClick={enviarRelatorio} disabled={!c.destinatariosRelatorio}>Enviar relatório à diretoria</button>
      <button className="bt leve" onClick={carregar}>Atualizar</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
    <div className="cf-box"><h2>Falhas — precisam de ação</h2>
      {!r.falhas.length && !r.confirmacoes.falhas.length ? <p className="muted">Nenhuma falha hoje.</p> :
        <table><thead><tr><th>Cliente</th><th>Contrato · parcela</th><th>Tipo</th><th>Status</th><th>Ação sugerida</th></tr></thead><tbody>
          {r.falhas.map((f: any, i: number) => <tr key={i}><td>{f.clienteNome}</td><td>{f.contrato} · {f.parcela}</td><td>{NOME_TIPO[f.tipo] ?? f.tipo}</td><td><Status s={f.status} motivo={f.motivo} /></td><td>{f.acao}</td></tr>)}
          {r.confirmacoes.falhas.map((f: any, i: number) => <tr key={`c${i}`}><td>—</td><td>{f.contrato}</td><td>Confirmação</td><td><Status s={f.status} motivo={f.motivo} /></td><td>{f.acao}</td></tr>)}
        </tbody></table>}
    </div>
    <div className="cf-box"><h2>Enviadas hoje</h2>
      {!r.enviadas.length && !r.confirmacoes.enviadas.length ? <p className="muted">Nada enviado ainda hoje.</p> :
        <table><thead><tr><th>Cliente</th><th>Contrato · parcela</th><th>Venc.</th><th className="num">Valor</th><th>Tipo</th></tr></thead><tbody>
          {r.enviadas.map((x: any, i: number) => <tr key={i}><td>{x.clienteNome}</td><td>{x.contrato} · {x.parcela}</td><td>{br(x.vencimento)}</td><td className="num">{brl(x.valor)}</td><td>{NOME_TIPO[x.tipo]}{x.etapa && x.tipo === "COBRANCA" ? ` ${x.etapa}` : ""}</td></tr>)}
          {r.confirmacoes.enviadas.map((x: any, i: number) => <tr key={`c${i}`}><td>—</td><td>{x.contrato}</td><td>pago {br(x.pagoEm)}</td><td className="num">{brl(x.valor)}</td><td>Confirmação</td></tr>)}
        </tbody></table>}
    </div>
    <div className="cf-box"><h2>Aguardando boleto no Sienge</h2>
      {!r.aguardandoBoleto.length ? <p className="muted">Nenhuma.</p> :
        <table><thead><tr><th>Cliente</th><th>Contrato · parcela</th><th>Venc.</th><th className="num">Valor</th><th>Ação</th></tr></thead><tbody>
          {r.aguardandoBoleto.map((x: any, i: number) => <tr key={i}><td>{x.clienteNome}</td><td>{x.contrato} · {x.parcela}</td><td>{br(x.vencimento)}</td><td className="num">{brl(x.valor)}</td><td>{x.acao}</td></tr>)}
        </tbody></table>}
    </div>
    {r.emTeste.length > 0 && <details className="cf-box"><summary><b>Em teste — {r.emTeste.length} mensagens só registradas</b></summary>
      <table style={{ marginTop: 10 }}><thead><tr><th>Cliente</th><th>Contrato · parcela</th><th>Venc.</th><th className="num">Valor</th><th>Tipo</th></tr></thead><tbody>
        {r.emTeste.map((x: any, i: number) => <tr key={i}><td>{x.clienteNome}</td><td>{x.contrato} · {x.parcela}</td><td>{br(x.vencimento)}</td><td className="num">{brl(x.valor)}</td><td>{NOME_TIPO[x.tipo]}{x.etapa && x.tipo === "COBRANCA" ? ` ${x.etapa}` : ""}</td></tr>)}
      </tbody></table></details>}
  </>;
}

// ---------- Clientes ----------
function Clientes({ abrirId }: { abrirId: number | null }) {
  const [q, setQ] = useState(""); const [lista, setLista] = useState<any[]>([]); const [sel, setSel] = useState<number | null>(abrirId);
  useEffect(() => { setSel(abrirId); }, [abrirId]);
  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => api(`/api/painel/clientes?q=${encodeURIComponent(q)}`).then(setLista).catch(() => setLista([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  if (sel) return <Ficha customerId={sel} voltar={() => setSel(null)} />;
  return <>
    <h1>Clientes</h1>
    <p className="sub">Busque pelo nome, número do contrato ou unidade.</p>
    <input className="busca" autoFocus placeholder="Ex.: Kalil, UMAR-05, R - 211…" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="cf-lista" style={{ marginTop: 12, maxWidth: 640 }}>
      {lista.map((c) => <button key={c.customerId} onClick={() => setSel(c.customerId)}><b>{c.nome}</b><small>{c.contratos.map((k: any) => `${k.numero} · ${k.empreendimento} ${k.unidades.join(", ")}`).join("  |  ")}</small></button>)}
      {q.trim().length >= 2 && !lista.length && <p className="muted">Nenhum cliente encontrado.</p>}
    </div>
  </>;
}

function Ficha({ customerId, voltar }: { customerId: number; voltar: () => void }) {
  const [d, setD] = useState<any>(null); const [erro, setErro] = useState("");
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<Pedido[] | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [pausaForm, setPausaForm] = useState(false);
  const carregar = useCallback(() => { setD(null); api(`/api/painel/cliente?customerId=${customerId}`).then(setD).catch((e) => setErro(e.message)); }, [customerId]);
  useEffect(carregar, [carregar]);
  if (erro) return <><button className="bt leve" onClick={voltar}>← Voltar</button><div className="cf-banner erro">{erro}</div></>;
  if (!d) return <><button className="bt leve" onClick={voltar}>← Voltar</button><p className="muted">Carregando dados do Sienge…</p></>;
  const chave = (p: any) => `${p.billId}/${p.installmentId}`;
  const itensMarcados = d.contratos.flatMap((c: any) => c.parcelas).filter((p: any) => marcadas[chave(p)]).map((p: any) => ({ billId: p.billId, installmentId: p.installmentId }));
  const abrir = (tipo: TipoEnvio) => setModal([{ tipo, customerId, nome: d.nome, itens: itensMarcados }]);
  async function removerPausa(id: string) { if (!confirm("Remover a pausa deste cliente?")) return; await api(`/api/painel/pausas?id=${id}`, { method: "DELETE" }); carregar(); }
  return <>
    <button className="bt leve mini" onClick={voltar}>← Voltar à busca</button>
    <h1 style={{ marginTop: 12 }}>{d.nome}</h1>
    <p className="sub">WhatsApp: <b>{d.telefone ?? "sem celular válido no Sienge"}</b> · cliente {customerId} no Sienge</p>
    {d.pausas.map((p: any) => <div key={p.id} className="cf-banner teste">⏸️ Em pausa ({p.tipos}{p.ate ? ` até ${br(p.ate)}` : ", sem prazo"}): {p.motivo} <button className="bt leve mini" onClick={() => removerPausa(p.id)}>Remover pausa</button></div>)}
    <div className="acoes" style={{ position: "sticky", top: 58, background: "#faf9f7", padding: "8px 0", zIndex: 3 }}>
      <span className="muted">{itensMarcados.length} parcela(s) marcada(s):</span>
      <button className="bt" disabled={!itensMarcados.length} onClick={() => abrir("BOLETO")}>Enviar boleto</button>
      <button className="bt" disabled={!itensMarcados.length} onClick={() => abrir("LEMBRETE_D0")}>Enviar lembrete</button>
      <button className="bt verm" disabled={!itensMarcados.length} onClick={() => abrir("COBRANCA")}>Enviar cobrança</button>
      {!d.pausas.length && <button className="bt leve" onClick={() => setPausaForm(true)}>Pausar cliente</button>}
      <label className="muted" style={{ fontSize: ".8rem" }}><input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> mostrar parcelas pagas e futuras distantes</label>
    </div>
    {pausaForm && <FormPausa contrato={d.contratos[0]?.numero} onDone={() => { setPausaForm(false); carregar(); }} />}
    {d.contratos.map((c: any) => {
      const ps = c.parcelas.filter((p: any) => verTodas || (!p.paga && p.diasAteVencimento <= 40));
      return <div className="cf-box" key={c.numero}>
        <h2>{c.numero} · {c.empreendimento} {c.unidades.join(", ")} <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem" }}>({c.situacao})</span></h2>
        {!ps.length ? <p className="muted">Nenhuma parcela em aberto nos próximos 40 dias.</p> :
          <table><thead><tr><th></th><th>Parcela</th><th>Vencimento</th><th className="num">Saldo</th><th>Boleto</th><th>Situação</th></tr></thead><tbody>
            {ps.map((p: any) => {
              const sit = p.paga ? <span className="cf-st ok">Paga</span> : p.diasAteVencimento < 0 ? <span className="cf-st er">{-p.diasAteVencimento} dia(s) em atraso</span> : p.diasAteVencimento === 0 ? <span className="cf-st al">Vence hoje</span> : <span className="cf-st">Vence em {p.diasAteVencimento} dia(s)</span>;
              return <tr key={chave(p)}><td>{!p.paga && <input type="checkbox" checked={!!marcadas[chave(p)]} onChange={(e) => setMarcadas({ ...marcadas, [chave(p)]: e.target.checked })} />}</td>
                <td>{p.parcela ?? `#${p.installmentId}`} <span className="muted">{p.tipoParc ?? ""}</span></td><td>{br(p.vencimento)}</td><td className="num">{brl(p.saldo)}</td>
                <td>{p.paga ? "—" : p.boletoGerado ? <span className="cf-st ok">Gerado</span> : <span className="cf-st er">Sem boleto</span>}</td><td>{sit}</td></tr>;
            })}
          </tbody></table>}
      </div>;
    })}
    <div className="cf-box"><h2>Mensagens</h2>
      {!d.comunicacoes.length && !d.confirmacoes.length ? <p className="muted">Nenhuma mensagem registrada.</p> :
        <table><thead><tr><th>Quando</th><th>Tipo</th><th>Contrato · parcela</th><th className="num">Valor</th><th>Status</th><th>Por</th></tr></thead><tbody>
          {d.comunicacoes.map((m: any, i: number) => <tr key={i} title={m.conteudo ?? ""}><td>{quando(m.enviadaEm ?? m.atualizadaEm)}</td><td>{NOME_TIPO[m.tipo] ?? m.tipo}{m.etapa ? ` ${m.etapa}` : ""}</td><td>{m.contrato} · {m.parcela}</td><td className="num">{brl(m.valor)}</td><td><Status s={m.status} motivo={m.motivo ?? m.detalhe} /></td><td className="muted">{m.solicitadoPor}</td></tr>)}
          {d.confirmacoes.map((m: any, i: number) => <tr key={`c${i}`}><td>{quando(m.enviadaEm)}</td><td>Confirmação</td><td>{m.contrato}</td><td className="num">{brl(m.valor)}</td><td><Status s={m.status} motivo={m.detalhe} /></td><td className="muted">cron</td></tr>)}
        </tbody></table>}
    </div>
    {modal && <ModalEnvio pedidos={modal} onClose={(enviou) => { setModal(null); if (enviou) { setMarcadas({}); carregar(); } }} />}
  </>;
}

// ---------- Inadimplência ----------
function Inadimplencia({ abrirCliente }: { abrirCliente: (id: number) => void }) {
  const [linhas, setLinhas] = useState<any[] | null>(null); const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState(""); const [sel, setSel] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<Pedido[] | null>(null);
  const carregar = useCallback(() => { setLinhas(null); api("/api/painel/inadimplentes").then(setLinhas).catch((e) => setErro(e.message)); }, []);
  useEffect(carregar, [carregar]);
  const emps = useMemo(() => [...new Set((linhas ?? []).map((l) => l.empreendimento))].sort(), [linhas]);
  const vis = (linhas ?? []).filter((l) => !filtro || l.empreendimento === filtro);
  const k = (l: any) => `${l.billId}/${l.installmentId}`;
  function cobrar() {
    const porCli = new Map<number, Pedido>();
    for (const l of vis.filter((x) => sel[k(x)])) {
      const p: Pedido = porCli.get(l.customerId) ?? { tipo: "COBRANCA", customerId: l.customerId, nome: l.cliente, itens: [] };
      p.itens.push({ billId: l.billId, installmentId: l.installmentId }); porCli.set(l.customerId, p);
    }
    setModal([...porCli.values()]);
  }
  if (erro) return <div className="cf-banner erro">{erro}</div>;
  const total = vis.reduce((s, l) => s + l.saldo, 0);
  return <>
    <h1>Inadimplência</h1>
    <p className="sub">Parcelas vencidas e em aberto no Sienge (ao vivo). Marque e envie a cobrança — um envio por cliente, com prévia.</p>
    <div className="acoes">
      <select value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todos os empreendimentos</option>{emps.map((e) => <option key={e}>{e}</option>)}</select>
      <button className="bt verm" disabled={!vis.some((l) => sel[k(l)])} onClick={cobrar}>Enviar cobrança às marcadas</button>
      <button className="bt leve" onClick={carregar}>Atualizar</button>
      {linhas && <span className="muted">{vis.length} parcela(s) · {brl(total)}</span>}
    </div>
    <div className="cf-box">{!linhas ? <p className="muted">Consultando o Sienge…</p> : !vis.length ? <p className="muted">Nenhuma parcela em atraso. 🎉</p> :
      <table><thead><tr><th><input type="checkbox" onChange={(e) => setSel(Object.fromEntries(vis.map((l) => [k(l), e.target.checked])))} /></th><th>Cliente</th><th>Contrato · parcela</th><th>Venc.</th><th className="num">Atraso</th><th className="num">Saldo</th><th>Boleto</th><th>Última cobrança</th></tr></thead><tbody>
        {vis.map((l) => <tr key={k(l)}><td><input type="checkbox" checked={!!sel[k(l)]} onChange={(e) => setSel({ ...sel, [k(l)]: e.target.checked })} /></td>
          <td><a href="#" onClick={(e) => { e.preventDefault(); abrirCliente(l.customerId); }}>{l.cliente}</a>{l.pausa && <div><span className="cf-st al" title={l.pausa}>em pausa</span></div>}</td>
          <td>{l.contrato} · {l.parcela ?? `#${l.installmentId}`}<div className="muted" style={{ fontSize: ".75rem" }}>{l.empreendimento} {l.unidades}</div></td>
          <td>{br(l.vencimento)}</td><td className="num">{l.diasAtraso} d</td><td className="num">{brl(l.saldo)}</td>
          <td>{l.boletoGerado ? <span className="cf-st ok">Gerado</span> : <span className="cf-st er">Sem boleto</span>}</td><td>{quando(l.ultimaCobranca)}</td></tr>)}
      </tbody></table>}</div>
    {modal && <ModalEnvio pedidos={modal} onClose={(enviou) => { setModal(null); if (enviou) { setSel({}); carregar(); } }} />}
  </>;
}

// ---------- Pausas ----------
function FormPausa({ contrato, onDone }: { contrato?: string; onDone: () => void }) {
  const [f, setF] = useState({ contrato: contrato ?? "", escopo: "cliente", tipos: "TODOS", ate: "", motivo: "" });
  const [erro, setErro] = useState("");
  async function salvar() {
    setErro("");
    try { await api("/api/painel/pausas", { method: "POST", body: JSON.stringify({ ...f, ate: f.ate || null }) }); onDone(); }
    catch (e: any) { setErro(e.message); }
  }
  return <div className="cf-box"><h2>Nova pausa</h2>
    <div className="linha">
      <label>Contrato<input value={f.contrato} onChange={(e) => setF({ ...f, contrato: e.target.value })} placeholder="UMAR210" /></label>
      <label>Alcance<select value={f.escopo} onChange={(e) => setF({ ...f, escopo: e.target.value })}><option value="cliente">Cliente inteiro</option><option value="contrato">Só este contrato</option></select></label>
      <label>Mensagens<select value={f.tipos} onChange={(e) => setF({ ...f, tipos: e.target.value })}><option value="TODOS">Todas</option><option value="COBRANCA">Só cobrança</option><option value="BOLETO,LEMBRETE_D0">Boleto e lembrete</option></select></label>
      <label>Até (opcional)<input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
      <label style={{ flex: 1, minWidth: 220 }}>Motivo<input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Ex.: em negociação" /></label>
      <button className="bt" onClick={salvar} disabled={!f.contrato || !f.motivo}>Pausar</button>
      <button className="bt leve" onClick={onDone}>Cancelar</button>
    </div>
    {erro && <p className="erro">{erro}</p>}
  </div>;
}

function Pausas() {
  const [ps, setPs] = useState<any[] | null>(null); const [novo, setNovo] = useState(false);
  const carregar = useCallback(() => { api("/api/painel/pausas").then(setPs).catch(() => setPs([])); }, []);
  useEffect(carregar, [carregar]);
  async function remover(id: string) { if (!confirm("Remover esta pausa? O cliente volta a receber as mensagens automáticas.")) return; await api(`/api/painel/pausas?id=${id}`, { method: "DELETE" }); carregar(); }
  return <>
    <h1>Pausas</h1>
    <p className="sub">Clientes ou contratos que não recebem mensagens automáticas (ex.: em negociação). Envios manuais continuam possíveis.</p>
    <div className="acoes"><button className="bt" onClick={() => setNovo(true)}>Nova pausa</button></div>
    {novo && <FormPausa onDone={() => { setNovo(false); carregar(); }} />}
    <div className="cf-box">{!ps ? <p className="muted">Carregando…</p> : !ps.length ? <p className="muted">Nenhuma pausa ativa.</p> :
      <table><thead><tr><th>Cliente</th><th>Contrato</th><th>Alcance</th><th>Mensagens</th><th>Até</th><th>Motivo</th><th>Criada</th><th></th></tr></thead><tbody>
        {ps.map((p) => <tr key={p.id}><td>{p.cliente}</td><td>{p.contrato}</td><td>{p.customerId ? "Cliente" : "Contrato"}</td><td>{p.tipos}</td><td>{p.ate ? br(p.ate) : "sem prazo"}</td><td>{p.motivo}</td><td className="muted">{quando(p.criadaEm)} · {p.criadoPor}</td><td><button className="bt leve mini" onClick={() => remover(p.id)}>Remover</button></td></tr>)}
      </tbody></table>}</div>
  </>;
}

// ---------- Régua ----------
function Regua() {
  const [cfg, setCfg] = useState<any>(null); const [r, setR] = useState<any>(null); const [rodando, setRodando] = useState(false);
  useEffect(() => { api("/api/painel/resumo").then((d) => setCfg(d.config)).catch(() => {}); }, []);
  async function exec(acao: "previa" | "rodar") {
    if (acao === "rodar" && !confirm(cfg?.reguaTeste ? "Rodar a régua agora (modo de teste: só registra)?" : "Rodar a régua agora? Os clientes RECEBERÃO as mensagens.")) return;
    setRodando(true); setR(null);
    try { setR(await api("/api/painel/regua", { method: "POST", body: JSON.stringify({ acao }) })); } catch (e: any) { setR({ erro: e.message }); }
    setRodando(false);
  }
  return <>
    <h1>Régua automática</h1>
    <p className="sub">Todo dia às 08h30: boleto {cfg?.diasAntes ?? 10} dias antes, lembrete no vencimento e cobrança em D+{(cfg?.etapas ?? [1, 7, 15]).join("/D+")} — só parcelas com boleto gerado e em aberto, exceto clientes em pausa. Confirmação de pagamento às 12h e 18h.</p>
    {cfg && <div className="cf-box"><table><tbody>
      <tr><td>Modo</td><td>{cfg.reguaTeste ? <span className="cf-st al">Teste (só registra)</span> : <span className="cf-st ok">Enviando aos clientes</span>}</td></tr>
      <tr><td>Boleto D-{cfg.diasAntes}</td><td>{cfg.boleto ? <span className="cf-st ok">Ligado</span> : <span className="cf-st">Desligado</span>}</td></tr>
      <tr><td>Lembrete D0</td><td>{cfg.lembrete ? <span className="cf-st ok">Ligado</span> : <span className="cf-st">Desligado</span>}</td></tr>
      <tr><td>Cobrança</td><td>{cfg.cobranca ? <span className="cf-st ok">Ligado</span> : <span className="cf-st">Desligado</span>}</td></tr>
      <tr><td>Relatório automático</td><td>{cfg.relatorioAuto ? <span className="cf-st ok">Ligado</span> : <span className="cf-st">Desligado</span>} · {cfg.destinatariosRelatorio} destinatário(s)</td></tr>
      <tr><td>Canal</td><td>{cfg.canal}</td></tr>
    </tbody></table><p className="muted" style={{ fontSize: ".8rem" }}>Estas chaves ficam nas variáveis do Railway (cron-regua).</p></div>}
    <div className="acoes" style={{ marginTop: 12 }}>
      <button className="bt" disabled={rodando} onClick={() => exec("previa")}>Ver prévia de hoje</button>
      <button className="bt leve" disabled={rodando} onClick={() => exec("rodar")}>Rodar agora</button>
      <span className="muted" style={{ fontSize: ".8rem" }}>Cada uma usa 1 das 20 consultas diárias ao Sienge.</span>
    </div>
    {rodando && <p className="muted">Consultando o Sienge…</p>}
    {r?.erro && <div className="cf-banner erro">{r.erro}</div>}
    {r && !r.erro && <div className="cf-box">
      <p>Parcelas lidas: <b>{r.parcelasLidas}</b> · planejadas: boleto {r.planejadas?.BOLETO}, lembrete {r.planejadas?.LEMBRETE_D0}, cobrança {r.planejadas?.COBRANCA} · já tratadas: {r.jaTratadas} · mensagens: {r.mensagens}</p>
      {r.skipped && <div className="cf-banner teste">{r.skipped}</div>}
      {Object.keys(r.porStatus ?? {}).length > 0 && <p>Resultado: {Object.entries(r.porStatus).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
      {r.pulados?.length > 0 && <details><summary>{r.pulados.length} parcela(s) puladas</summary><ul>{r.pulados.map((p: any, i: number) => <li key={i}>título {p.billId}/{p.installmentId} ({NOME_TIPO[p.tipo]}): {p.motivo}</li>)}</ul></details>}
      {r.previews?.map((p: any, i: number) => <details key={i} style={{ marginTop: 8 }}><summary>{NOME_TIPO[p.tipo]} — {p.nome} ({p.parcelas.length} parcela(s)) {p.telefone ? "" : "· SEM TELEFONE"}</summary><div className="cf-msg" style={{ marginTop: 6 }}>{p.mensagem}</div></details>)}
    </div>}
  </>;
}

// ---------- Histórico ----------
function Historico() {
  const [f, setF] = useState({ tipo: "", status: "", dias: "7" }); const [ls, setLs] = useState<any[] | null>(null);
  useEffect(() => { setLs(null); api(`/api/painel/historico?${new URLSearchParams(f)}`).then(setLs).catch(() => setLs([])); }, [f]);
  return <>
    <h1>Histórico</h1>
    <p className="sub">Tudo o que o sistema enviou, tentou enviar ou registrou.</p>
    <div className="acoes">
      <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos os tipos</option><option value="BOLETO">Boleto</option><option value="LEMBRETE_D0">Lembrete</option><option value="COBRANCA">Cobrança</option><option value="CONFIRMACAO">Confirmação</option><option value="RELATORIO_DIA">Relatório</option></select>
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option><option value="ENVIADA">Enviada</option><option value="SENT">Enviada (confirmação)</option><option value="DRY_RUN">Teste</option><option value="PLANEJADA">Aguardando</option><option value="ERRO">Erro</option><option value="SEM_WHATSAPP">Sem WhatsApp</option><option value="SEM_TELEFONE">Sem telefone</option><option value="INCERTA">Incerta</option></select>
      <select value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })}><option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select>
    </div>
    <div className="cf-box">{!ls ? <p className="muted">Carregando…</p> : !ls.length ? <p className="muted">Nada no período.</p> :
      <table><thead><tr><th>Quando</th><th>Tipo</th><th>Cliente</th><th>Contrato · parcela</th><th className="num">Valor</th><th>Status</th><th>Por</th></tr></thead><tbody>
        {ls.map((l, i) => <tr key={i}><td>{quando(l.quando)}</td><td>{NOME_TIPO[l.tipo] ?? l.tipo}{l.etapa ? ` ${l.etapa}` : ""}</td><td>{l.cliente ?? "—"}</td><td>{l.contrato ?? "—"}{l.parcela ? ` · ${l.parcela}` : ""}</td><td className="num">{brl(l.valor)}</td><td><Status s={l.status} motivo={l.motivo ?? l.detalhe} /></td><td className="muted">{l.solicitadoPor}</td></tr>)}
      </tbody></table>}</div>
  </>;
}

// ---------- Shell ----------
export default function Painel() {
  const [aba, setAba] = useState<Aba>("hoje");
  const [cliente, setCliente] = useState<number | null>(null);
  const abas: [Aba, string][] = [["hoje", "Hoje"], ["clientes", "Clientes"], ["inadimplencia", "Inadimplência"], ["pausas", "Pausas"], ["regua", "Régua"], ["historico", "Histórico"]];
  return <div className="cf">
    <div className="cf-top"><div className="cf-top-in">
      <div className="cf-marca">CASA <span>FORTE</span> · Financeiro</div>
      <nav className="cf-nav">{abas.map(([k, r]) => <button key={k} className={aba === k ? "ativo" : ""} onClick={() => { setAba(k); if (k !== "clientes") setCliente(null); }}>{r}</button>)}</nav>
    </div></div>
    <main className="cf-main">
      {aba === "hoje" && <Hoje />}
      {aba === "clientes" && <Clientes abrirId={cliente} />}
      {aba === "inadimplencia" && <Inadimplencia abrirCliente={(id) => { setCliente(id); setAba("clientes"); }} />}
      {aba === "pausas" && <Pausas />}
      {aba === "regua" && <Regua />}
      {aba === "historico" && <Historico />}
    </main>
  </div>;
}
