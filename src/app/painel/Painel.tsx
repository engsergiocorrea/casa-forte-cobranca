"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icone } from "./icones";

// Painel do financeiro (cobranca.casaforteinc.com.br). Abas: Hoje, Clientes,
// Inadimplência, Pausas, Régua, Histórico. Todo envio passa por PRÉVIA →
// CONFIRMAR (o último comando é da pessoa). Os dados vêm de /api/painel/*.
// Pensado para celular (iPhone/Android, Safari/Chrome): tabelas viram cartões,
// ações ficam numa barra fixa no rodapé, campos com 16px (sem zoom no iOS).

type Aba = "hoje" | "clientes" | "inadimplencia" | "pausas" | "regua" | "historico";
type TipoEnvio = "BOLETO" | "LEMBRETE_D0" | "COBRANCA";

const brl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const br = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "—");
const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Maceio", dateStyle: "short", timeStyle: "short" }) : "—");
const NOME_TIPO: Record<string, string> = { BOLETO: "Boleto", LEMBRETE_D0: "Lembrete", COBRANCA: "Cobrança", CONFIRMACAO: "Confirmação", RELATORIO_DIA: "Relatório" };
const NOME_ACAO: Record<TipoEnvio, string> = { BOLETO: "Enviar boleto", LEMBRETE_D0: "Enviar lembrete", COBRANCA: "Enviar cobrança" };
const tipoEtapa = (t: string, e?: string | null) => `${NOME_TIPO[t] ?? t}${e && t === "COBRANCA" && e !== "MANUAL" ? ` ${e}` : ""}`;

function Status({ s, motivo }: { s: string; motivo?: string | null }) {
  const ok = ["ENVIADA", "ENTREGUE", "LIDA", "SENT"].includes(s);
  const er = ["ERRO", "ERROR", "INCERTA", "UNCERTAIN", "SEM_TELEFONE", "NO_PHONE", "SEM_WHATSAPP", "NO_WHATSAPP", "BLOQUEADA", "BLOCKED"].includes(s);
  const rot: Record<string, string> = { ENVIADA: "Enviada", SENT: "Enviada", ENTREGUE: "Entregue", LIDA: "Lida", DRY_RUN: "Teste", PLANEJADA: "Aguardando", ERRO: "Erro", ERROR: "Erro", INCERTA: "Incerta", UNCERTAIN: "Incerta", SEM_TELEFONE: "Sem telefone", NO_PHONE: "Sem telefone", SEM_WHATSAPP: "Sem WhatsApp", NO_WHATSAPP: "Sem WhatsApp", BLOQUEADA: "Bloqueada", BLOCKED: "Bloqueada", ENVIANDO: "Enviando", SENDING: "Enviando" };
  return <span className={`cf-st ${ok ? "ok" : er ? "er" : "al"}`} title={motivo ?? ""}>{rot[s] ?? s}</span>;
}

// Modo demonstração SÓ local (http://localhost…?mock=1): dados fictícios para
// revisar o layout sem banco. Em produção nunca é usado.
const emMock = () => typeof window !== "undefined" && window.location.hostname === "localhost" && new URLSearchParams(window.location.search).has("mock");

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  if (emMock()) { const { mockApi } = await import("./mock"); await new Promise((r) => setTimeout(r, 150)); return mockApi(url, init) as T; }
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.erro ?? `Erro ${r.status}`);
  return j as T;
}

// Tabela que vira lista de cartões no celular (cada célula mostra o rótulo).
type Col = { t: string; num?: boolean; chk?: boolean; destaque?: boolean; bloco?: boolean }; // bloco: texto longo, no celular fica embaixo do rótulo
function Tabela({ cols, linhas, vazio }: { cols: Col[]; linhas: { k: string; c: ReactNode[]; title?: string; marcada?: boolean }[]; vazio?: string }) {
  if (!linhas.length) return <p className="muted">{vazio ?? "Nada."}</p>;
  return <table className="cf-t">
    <thead><tr>{cols.map((c, i) => <th key={i} className={c.num ? "num" : ""}>{c.t}</th>)}</tr></thead>
    <tbody>{linhas.map((l) => <tr key={l.k} title={l.title} className={l.marcada ? "marcada" : ""}>
      {l.c.map((v, i) => <td key={i} data-label={cols[i].chk || cols[i].destaque ? "" : cols[i].t} className={[cols[i].num && "num", cols[i].chk && "chk", cols[i].destaque && "dest", cols[i].bloco && "bloco"].filter(Boolean).join(" ")}>{v}</td>)}
    </tr>)}</tbody>
  </table>;
}

// ---------- Modal de envio (prévia → confirmar) ----------
type Pedido = { tipo: TipoEnvio; customerId: number; nome?: string; itens: { billId: number; installmentId: number }[] };
function ModalEnvio({ pedidos, onClose }: { pedidos: Pedido[]; onClose: (enviou: boolean) => void }) {
  const [previas, setPrevias] = useState<any[] | null>(null);
  const [res, setRes] = useState<any[] | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    (async () => {
      try { setPrevias(await Promise.all(pedidos.map((p) => api("/api/painel/envio", { method: "POST", body: JSON.stringify({ ...p, acao: "previa" }) })))); }
      catch (e: any) { setErro(e.message); }
    })();
    return () => { document.body.style.overflow = ""; };
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
    <div className="cf-modal-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="cf-modal-cab">
        <h2>{NOME_ACAO[pedidos[0].tipo]}</h2>
        <p className="muted">{pedidos.length > 1 ? `${pedidos.length} clientes` : (previas?.[0]?.nome || pedidos[0].nome || "cliente")}</p>
      </div>
      <div className="cf-modal-corpo">
        {erro && <p className="erro">{erro}</p>}
        {!previas && !erro && <p className="muted">Conferindo no Sienge (saldo, boleto e telefone)…</p>}
        {previas && !res && previas.map((p, i) => <div key={i} style={{ marginBottom: 18 }}>
          {pedidos.length > 1 && <h3>{p.nome}</h3>}
          <p className="cf-fone">WhatsApp: <b>{p.telefone || "sem celular no Sienge"}</b></p>
          {p.avisos?.map((a: string, k: number) => <div key={k} className="cf-banner teste">{a}</div>)}
          {p.bloqueados?.map((b: any, k: number) => <div key={k} className="cf-banner erro">Parcela {b.installmentId} fora: {b.motivo}</div>)}
          {p.mensagem ? <div className="cf-msg">{p.mensagem}</div> : <p className="erro">Nada a enviar para este cliente.</p>}
        </div>)}
        {res && res.map((r, i) => <div key={i} className={`cf-banner ${r.enviado ? "ok" : "erro"}`}>{r.nome || "Cliente"}: {r.enviado ? "enviado ✓" : `${r.status}${r.detalhe ? ` — ${r.detalhe}` : ""}`}{r.ignorados?.length ? ` (${r.ignorados.length} já enviado(s) hoje)` : ""}</div>)}
      </div>
      <div className="cf-modal-rodape">
        {!res && <button className="bt verm grande" disabled={!enviaveis.length || enviando} onClick={confirmar}>{enviando ? "Enviando…" : `Confirmar e enviar${enviaveis.length > 1 ? ` (${enviaveis.length})` : ""}`}</button>}
        <button className="bt leve grande" disabled={enviando} onClick={() => onClose(!!res)}>{res ? "Fechar" : "Cancelar"}</button>
      </div>
    </div>
  </div>;
}

// ---------- Peças de layout ----------
function Kpi({ i, n, rot, tom }: { i: string; n: number; rot: string; tom?: "ok" | "alerta" }) {
  return <div className={`cf-card ${tom ?? ""}`}><span className="cf-card-ic"><Icone n={i} t={18} /></span><b>{n}</b><span className="cf-card-rot">{rot}</span></div>;
}
function Cabecalho({ titulo, sub, extra }: { titulo: string; sub?: string; extra?: ReactNode }) {
  return <div className="cf-cab"><div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>{extra}</div>;
}

// Casa Forte Brain — conversa com o assistente (projeto casaforte-ia) pela
// rota /api/painel/brain. As regras ficam no Brain: ele consulta à vontade, mas
// todo envio mostra o resumo e só acontece depois de "Confirmo" da pessoa.
// A conversa da aba fica no sessionStorage (some ao fechar o navegador; o Brain
// guarda o contexto por 12h do lado dele).
const EXEMPLOS_BRAIN = [
  "O Marco Defaz recebeu a confirmação de pagamento?",
  "Quais clientes estão com mais de 15 dias de atraso?",
  "Como foi o dia de hoje na cobrança?",
  "Envie o boleto da próxima parcela do contrato UMAR-05",
];
type MsgBrain = { de: "eu" | "brain" | "erro"; texto: string };
const CHAVE_BRAIN = "cf-brain-conversa";

// *negrito* e quebras de linha (formato WhatsApp), sem HTML cru.
function TextoBrain({ t }: { t: string }) {
  return <>{t.split("\n").map((linha, i) => <span key={i} className="cf-brain-linha">{linha.split(/(\*[^*\n]+\*)/g).map((x, k) => /^\*[^*]+\*$/.test(x) ? <b key={k}>{x.slice(1, -1)}</b> : x)}{"\n"}</span>)}</>;
}

function BrainModal({ onClose }: { onClose: () => void }) {
  const [estado, setEstado] = useState<{ configurado: boolean; liberado: boolean } | null>(null);
  const [msgs, setMsgs] = useState<MsgBrain[]>(() => { try { return JSON.parse(sessionStorage.getItem(CHAVE_BRAIN) ?? "[]"); } catch { return []; } });
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { document.body.style.overflow = "hidden"; const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", esc); return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", esc); }; }, [onClose]);
  useEffect(() => { api("/api/painel/brain").then(setEstado).catch(() => setEstado({ configurado: false, liberado: false })); }, []);
  useEffect(() => { try { sessionStorage.setItem(CHAVE_BRAIN, JSON.stringify(msgs.slice(-60))); } catch { /* sem storage */ } fim.current?.scrollIntoView({ block: "end" }); }, [msgs, pensando]);

  const enviar = async (m: string) => {
    const t = m.trim(); if (!t || pensando) return;
    setTexto(""); setMsgs((x) => [...x, { de: "eu", texto: t }]); setPensando(true);
    try { const r = await api<{ resposta: string }>("/api/painel/brain", { method: "POST", body: JSON.stringify({ mensagem: t }) }); setMsgs((x) => [...x, { de: "brain", texto: r.resposta }]); }
    catch (e) { setMsgs((x) => [...x, { de: "erro", texto: (e as Error).message }]); }
    finally { setPensando(false); }
  };
  const ultima = msgs[msgs.length - 1];
  const pedeConfirmacao = !pensando && ultima?.de === "brain" && /confirmo/i.test(ultima.texto);
  const pronto = estado?.configurado && estado.liberado;

  return <div className="cf-modal" onClick={onClose}>
    <div className="cf-modal-in cf-brain" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="brain-tit">
      <div className="cf-modal-cab cf-brain-cab">
        <span className="cf-brain-orb"><Icone n="brain" t={22} /></span>
        <div><h2 id="brain-tit">Casa Forte Brain</h2><p>Assistente com IA para o financeiro{pronto ? "" : <> · <b>em integração</b></>}</p></div>
        <button className="cf-brain-fechar" onClick={onClose} aria-label="Fechar">✕</button>
      </div>
      <div className="cf-modal-corpo cf-brain-corpo" aria-live="polite">
        {estado && !pronto && <div className="cf-brain-reg"><Icone n="escudo" t={18} /><div>{!estado.configurado
          ? <><b>O Brain ainda não está ligado.</b> Falta configurar a conexão no Railway (BRAIN_URL e BRAIN_WEB_TOKEN).</>
          : <><b>Seu usuário ainda não está liberado no Brain.</b> Peça para incluir o seu celular em BRAIN_USUARIOS.</>}</div></div>}
        {!msgs.length && <>
          <p>Pergunte em linguagem natural. Alguns exemplos:</p>
          <ul className="cf-brain-ex">{EXEMPLOS_BRAIN.map((x) => <li key={x}><button disabled={!pronto} onClick={() => enviar(x)}><Icone n="brain" t={14} /> “{x}”</button></li>)}</ul>
          <div className="cf-brain-reg"><Icone n="escudo" t={18} /><div><b>As mesmas regras do painel.</b> O Brain consulta o Sienge e o histórico, mas todo envio mostra o resumo antes e só sai depois do seu “Confirmo”. Cada ação fica registrada com o nome de quem pediu.</div></div>
        </>}
        <div className="cf-brain-msgs">{msgs.map((m, i) => <div key={i} className={`cf-brain-msg ${m.de}`}><TextoBrain t={m.texto} /></div>)}
          {pensando && <div className="cf-brain-msg brain pensando" aria-label="Pensando"><span /><span /><span /></div>}
          <div ref={fim} /></div>
      </div>
      <div className="cf-modal-rodape cf-brain-rodape">
        {pedeConfirmacao && <div className="cf-brain-conf"><button className="bt verm" onClick={() => enviar("Confirmo")}>Confirmo</button><button className="bt leve" onClick={() => enviar("Cancelar")}>Cancelar</button></div>}
        <form className="cf-brain-form" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
          <textarea rows={1} value={texto} disabled={!pronto} placeholder={pronto ? "Mensagem…" : "Indisponível"} aria-label="Mensagem para o Brain"
            onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(texto); } }} />
          <button className="bt verm" type="submit" disabled={!pronto || pensando || !texto.trim()}>Enviar</button>
        </form>
        {msgs.length > 0 && <button className="cf-brain-limpar" onClick={() => setMsgs([])}>Limpar conversa da tela</button>}
      </div>
    </div>
  </div>;
}

function Rodape() {
  const ano = new Date().getFullYear();
  return <footer className="cf-rodape">
    <div>© {ano} Construções e Empreendimentos Casa Forte Ltda. · CNPJ 37.301.810/0001-98 · Todos os direitos reservados.</div>
    <div className="muted">Sistema interno de uso restrito. Acessos e ações são registrados. · <a href="https://casaforteinc.com.br" target="_blank" rel="noreferrer">casaforteinc.com.br</a></div>
  </footer>;
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
  const colsLista: Col[] = [{ t: "Cliente", destaque: true }, { t: "Contrato" }, { t: "Vencimento" }, { t: "Valor", num: true }, { t: "Tipo" }];
  const colsAcao: Col[] = [{ t: "Cliente", destaque: true }, { t: "Contrato" }, { t: "Tipo" }, { t: "Status" }, { t: "O que fazer", bloco: true }];
  return <>
    <Cabecalho titulo="Hoje" sub="O que a comunicação financeira fez hoje e o que precisa de ação." extra={<span className="cf-data">{br(d.data)}</span>} />
    {c.reguaTeste ? <div className="cf-banner teste">🧪 Régua automática em <b>modo de teste</b>: nada sai sozinho para os clientes. Envios feitos aqui no painel saem de verdade.</div>
      : <div className="cf-banner ok">Régua automática <b>ligada</b> — {[c.boleto && "boleto", c.lembrete && "lembrete", c.cobranca && "cobrança"].filter(Boolean).join(", ") || "nenhum tipo"}.</div>}
    {!c.envioLigado && <div className="cf-banner erro">Envio de WhatsApp <b>desligado</b>.</div>}
    <div className="cf-cards">
      <Kpi i="boleto" n={r.resumo.boletos} rot="Boletos enviados" />
      <Kpi i="lembrete" n={r.resumo.lembretes} rot="Lembretes" />
      <Kpi i="cobranca" n={r.resumo.cobrancas} rot="Cobranças" />
      <Kpi i="confirmacao" n={r.resumo.confirmacoes} rot="Confirmações" tom="ok" />
      <Kpi i="falha" n={r.resumo.falhas} rot="Falhas" tom={r.resumo.falhas ? "alerta" : undefined} />
      <Kpi i="aguardando" n={r.resumo.aguardandoBoleto} rot="Aguardando boleto" />
      <Kpi i="teste" n={r.resumo.emTeste} rot="Em teste" />
      <Kpi i="pausa" n={r.resumo.pausas} rot="Em pausa" />
    </div>
    <div className="acoes">
      <a className="bt leve" href="/api/painel/relatorio" target="_blank" rel="noreferrer"><Icone n="pdf" /> Relatório (PDF)</a>
      <button className="bt" onClick={enviarRelatorio} disabled={!c.destinatariosRelatorio}><Icone n="enviar" /> Enviar à diretoria</button>
      <button className="bt leve" onClick={carregar}><Icone n="atualizar" /> Atualizar</button>
    </div>
    {msg && <p className="muted">{msg}</p>}
    <section className="cf-box"><h2>Falhas — precisam de ação</h2>
      <Tabela cols={colsAcao} vazio="Nenhuma falha hoje. ✔️" linhas={[
        ...r.falhas.map((f: any, i: number) => ({ k: `f${i}`, c: [f.clienteNome, `${f.contrato} · ${f.parcela}`, tipoEtapa(f.tipo, f.etapa), <Status key="s" s={f.status} motivo={f.motivo} />, f.acao] })),
        ...r.confirmacoes.falhas.map((f: any, i: number) => ({ k: `c${i}`, c: [`Confirmação ${f.contrato}`, f.contrato, "Confirmação", <Status key="s" s={f.status} motivo={f.motivo} />, f.acao] })),
      ]} />
    </section>
    <section className="cf-box"><h2>Enviadas hoje</h2>
      <Tabela cols={colsLista} vazio="Nada enviado ainda hoje." linhas={[
        ...r.enviadas.map((x: any, i: number) => ({ k: `e${i}`, c: [x.clienteNome, `${x.contrato} · ${x.parcela}`, br(x.vencimento), brl(x.valor), tipoEtapa(x.tipo, x.etapa)] })),
        ...r.confirmacoes.enviadas.map((x: any, i: number) => ({ k: `c${i}`, c: [`Confirmação ${x.contrato}`, x.contrato, `pago ${br(x.pagoEm)}`, brl(x.valor), "Confirmação"] })),
      ]} />
    </section>
    <section className="cf-box"><h2>Aguardando boleto no Sienge</h2>
      <Tabela cols={[{ t: "Cliente", destaque: true }, { t: "Contrato" }, { t: "Vencimento" }, { t: "Valor", num: true }, { t: "O que fazer", bloco: true }]} vazio="Nenhuma." linhas={
        r.aguardandoBoleto.map((x: any, i: number) => ({ k: `a${i}`, c: [x.clienteNome, `${x.contrato} · ${x.parcela}`, br(x.vencimento), brl(x.valor), x.acao] }))} />
    </section>
    {r.emTeste.length > 0 && <details className="cf-box"><summary><b>Em teste — {r.emTeste.length} mensagens só registradas</b></summary>
      <div style={{ marginTop: 10 }}><Tabela cols={colsLista} linhas={r.emTeste.map((x: any, i: number) => ({ k: `t${i}`, c: [x.clienteNome, `${x.contrato} · ${x.parcela}`, br(x.vencimento), brl(x.valor), tipoEtapa(x.tipo, x.etapa)] }))} /></div>
    </details>}
  </>;
}

// ---------- Clientes ----------
function Clientes({ abrirId }: { abrirId: number | null }) {
  const [q, setQ] = useState(""); const [lista, setLista] = useState<any[]>([]); const [sel, setSel] = useState<number | null>(abrirId); const [buscando, setBuscando] = useState(false);
  useEffect(() => { setSel(abrirId); }, [abrirId]);
  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(() => api(`/api/painel/clientes?q=${encodeURIComponent(q)}`).then(setLista).catch(() => setLista([])).finally(() => setBuscando(false)), 300);
    return () => clearTimeout(t);
  }, [q]);
  if (sel) return <Ficha customerId={sel} voltar={() => setSel(null)} />;
  return <>
    <Cabecalho titulo="Clientes" sub="Busque pelo nome, número do contrato ou unidade." />
    <input className="busca" type="search" inputMode="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" placeholder="Ex.: Kalil, UMAR-05, R - 211…" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="cf-lista">
      {lista.map((c) => <button key={c.customerId} onClick={() => setSel(c.customerId)}><b>{c.nome}</b><small>{c.contratos.map((k: any) => `${k.numero} · ${k.empreendimento} ${k.unidades.join(", ")}`).join("  |  ")}</small></button>)}
      {q.trim().length >= 2 && !lista.length && <p className="muted">{buscando ? "Buscando…" : "Nenhum cliente encontrado."}</p>}
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
  if (erro) return <><button className="bt leve mini" onClick={voltar}>← Voltar</button><div className="cf-banner erro">{erro}</div></>;
  if (!d) return <><button className="bt leve mini" onClick={voltar}>← Voltar</button><p className="muted">Carregando dados do Sienge…</p></>;
  const chave = (p: any) => `${p.billId}/${p.installmentId}`;
  const itensMarcados = d.contratos.flatMap((c: any) => c.parcelas).filter((p: any) => marcadas[chave(p)]).map((p: any) => ({ billId: p.billId, installmentId: p.installmentId }));
  const abrir = (tipo: TipoEnvio) => setModal([{ tipo, customerId, nome: d.nome, itens: itensMarcados }]);
  const alternar = (p: any) => !p.paga && setMarcadas((m) => ({ ...m, [chave(p)]: !m[chave(p)] }));
  async function removerPausa(id: string) { if (!confirm("Remover a pausa deste cliente?")) return; await api(`/api/painel/pausas?id=${id}`, { method: "DELETE" }); carregar(); }
  return <div className="com-barra">
    <button className="bt leve mini" onClick={voltar}>← Voltar à busca</button>
    <h1 style={{ marginTop: 12 }}>{d.nome}</h1>
    <p className="sub">WhatsApp: <b>{d.telefone ?? "sem celular válido no Sienge"}</b></p>
    {d.pausas.map((p: any) => <div key={p.id} className="cf-banner teste">⏸️ Em pausa ({p.tipos}{p.ate ? ` até ${br(p.ate)}` : ", sem prazo"}): {p.motivo} <button className="bt leve mini" onClick={() => removerPausa(p.id)}>Remover pausa</button></div>)}
    <div className="acoes">
      {!d.pausas.length && <button className="bt leve mini" onClick={() => setPausaForm(true)}>Pausar cliente</button>}
      <label className="cf-check"><input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> Mostrar pagas e futuras</label>
    </div>
    {pausaForm && <FormPausa contrato={d.contratos[0]?.numero} onDone={() => { setPausaForm(false); carregar(); }} />}
    {d.contratos.map((c: any) => {
      const ps = c.parcelas.filter((p: any) => verTodas || (!p.paga && p.diasAteVencimento <= 40));
      return <section className="cf-box" key={c.numero}>
        <h2>{c.numero} · {c.empreendimento} {c.unidades.join(", ")}</h2>
        <Tabela cols={[{ t: "", chk: true }, { t: "Parcela", destaque: true }, { t: "Vencimento" }, { t: "Saldo", num: true }, { t: "Boleto" }, { t: "Situação" }]}
          vazio="Nenhuma parcela em aberto nos próximos 40 dias." linhas={ps.map((p: any) => ({
            k: chave(p), marcada: !!marcadas[chave(p)],
            c: [
              !p.paga ? <input type="checkbox" aria-label="Marcar parcela" checked={!!marcadas[chave(p)]} onChange={() => alternar(p)} /> : null,
              <span key="p" onClick={() => alternar(p)}>{p.parcela ? `Parcela ${p.parcela}` : `Parcela #${p.installmentId}`} <span className="muted">{p.tipoParc ?? ""}</span></span>,
              br(p.vencimento), brl(p.saldo),
              p.paga ? "—" : p.boletoGerado ? <span className="cf-st ok">Gerado</span> : <span className="cf-st er">Sem boleto</span>,
              p.paga ? <span className="cf-st ok">Paga</span> : p.diasAteVencimento < 0 ? <span className="cf-st er">{-p.diasAteVencimento} d em atraso</span> : p.diasAteVencimento === 0 ? <span className="cf-st al">Vence hoje</span> : <span className="cf-st">em {p.diasAteVencimento} d</span>,
            ],
          }))} />
      </section>;
    })}
    <section className="cf-box"><h2>Mensagens</h2>
      <Tabela cols={[{ t: "Tipo", destaque: true }, { t: "Quando" }, { t: "Contrato" }, { t: "Valor", num: true }, { t: "Status" }, { t: "Por" }]} vazio="Nenhuma mensagem registrada." linhas={[
        ...d.comunicacoes.map((m: any, i: number) => ({ k: `m${i}`, title: m.conteudo ?? "", c: [tipoEtapa(m.tipo, m.etapa) + (m.etapa === "MANUAL" ? " (manual)" : ""), quando(m.enviadaEm ?? m.atualizadaEm), `${m.contrato} · ${m.parcela}`, brl(m.valor), <Status key="s" s={m.status} motivo={m.motivo ?? m.detalhe} />, m.solicitadoPor] })),
        ...d.confirmacoes.map((m: any, i: number) => ({ k: `c${i}`, c: ["Confirmação", quando(m.enviadaEm), m.contrato, brl(m.valor), <Status key="s" s={m.status} motivo={m.detalhe} />, "cron"] })),
      ]} />
    </section>
    <div className="cf-barra">
      <span className="cf-barra-info">{itensMarcados.length ? `${itensMarcados.length} parcela(s) marcada(s)` : "Marque as parcelas para enviar"}</span>
      <div className="cf-barra-bts">
        <button className="bt" disabled={!itensMarcados.length} onClick={() => abrir("BOLETO")}>Boleto</button>
        <button className="bt" disabled={!itensMarcados.length} onClick={() => abrir("LEMBRETE_D0")}>Lembrete</button>
        <button className="bt verm" disabled={!itensMarcados.length} onClick={() => abrir("COBRANCA")}>Cobrança</button>
      </div>
    </div>
    {modal && <ModalEnvio pedidos={modal} onClose={(enviou) => { setModal(null); if (enviou) { setMarcadas({}); carregar(); } }} />}
  </div>;
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
  const nSel = vis.filter((l) => sel[k(l)]).length;
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
  return <div className="com-barra">
    <Cabecalho titulo="Inadimplência" sub="Parcelas vencidas e em aberto no Sienge (ao vivo). Marque e envie a cobrança — uma mensagem por cliente, com prévia." />
    <div className="acoes">
      <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Empreendimento"><option value="">Todos os empreendimentos</option>{emps.map((e) => <option key={e}>{e}</option>)}</select>
      <button className="bt leve" onClick={carregar}>Atualizar</button>
    </div>
    {linhas && <p className="muted">{vis.length} parcela(s) · {brl(total)} em aberto</p>}
    <section className="cf-box">{!linhas ? <p className="muted">Consultando o Sienge…</p> :
      <Tabela cols={[{ t: "", chk: true }, { t: "Cliente", destaque: true }, { t: "Contrato" }, { t: "Vencimento" }, { t: "Atraso", num: true }, { t: "Saldo", num: true }, { t: "Boleto" }, { t: "Última cobrança" }]}
        vazio="Nenhuma parcela em atraso. 🎉" linhas={vis.map((l) => ({
          k: k(l), marcada: !!sel[k(l)],
          c: [
            <input key="c" type="checkbox" aria-label="Marcar parcela" checked={!!sel[k(l)]} onChange={(e) => setSel({ ...sel, [k(l)]: e.target.checked })} />,
            <span key="n"><a href="#" onClick={(e) => { e.preventDefault(); abrirCliente(l.customerId); }}>{l.cliente}</a>{l.pausa && <> <span className="cf-st al" title={l.pausa}>em pausa</span></>}</span>,
            `${l.contrato} · ${l.parcela ?? `#${l.installmentId}`}`, br(l.vencimento), `${l.diasAtraso} dias`, brl(l.saldo),
            l.boletoGerado ? <span className="cf-st ok">Gerado</span> : <span className="cf-st er">Sem boleto</span>, quando(l.ultimaCobranca),
          ],
        }))} />}</section>
    <div className="cf-barra">
      <span className="cf-barra-info">{nSel ? `${nSel} parcela(s) marcada(s)` : "Marque as parcelas para cobrar"}</span>
      <div className="cf-barra-bts">
        <button className="bt leve" onClick={() => setSel(Object.fromEntries(vis.map((l) => [k(l), !nSel])))}>{nSel ? "Desmarcar" : "Marcar todas"}</button>
        <button className="bt verm" disabled={!nSel} onClick={cobrar}>Enviar cobrança</button>
      </div>
    </div>
    {modal && <ModalEnvio pedidos={modal} onClose={(enviou) => { setModal(null); if (enviou) { setSel({}); carregar(); } }} />}
  </div>;
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
  return <section className="cf-box"><h2>Nova pausa</h2>
    <div className="cf-form">
      <label>Contrato<input value={f.contrato} autoCapitalize="characters" onChange={(e) => setF({ ...f, contrato: e.target.value })} placeholder="UMAR210" /></label>
      <label>Alcance<select value={f.escopo} onChange={(e) => setF({ ...f, escopo: e.target.value })}><option value="cliente">Cliente inteiro</option><option value="contrato">Só este contrato</option></select></label>
      <label>Mensagens<select value={f.tipos} onChange={(e) => setF({ ...f, tipos: e.target.value })}><option value="TODOS">Todas</option><option value="COBRANCA">Só cobrança</option><option value="BOLETO,LEMBRETE_D0">Boleto e lembrete</option></select></label>
      <label>Até (opcional)<input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
      <label className="largo">Motivo<input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Ex.: em negociação" /></label>
    </div>
    {erro && <p className="erro">{erro}</p>}
    <div className="acoes" style={{ marginTop: 12 }}>
      <button className="bt" onClick={salvar} disabled={!f.contrato || !f.motivo}>Pausar</button>
      <button className="bt leve" onClick={onDone}>Cancelar</button>
    </div>
  </section>;
}

function Pausas() {
  const [ps, setPs] = useState<any[] | null>(null); const [novo, setNovo] = useState(false);
  const carregar = useCallback(() => { api("/api/painel/pausas").then(setPs).catch(() => setPs([])); }, []);
  useEffect(carregar, [carregar]);
  async function remover(id: string) { if (!confirm("Remover esta pausa? O cliente volta a receber as mensagens automáticas.")) return; await api(`/api/painel/pausas?id=${id}`, { method: "DELETE" }); carregar(); }
  return <>
    <Cabecalho titulo="Pausas" sub="Clientes ou contratos que não recebem mensagens automáticas (ex.: em negociação). Envios manuais continuam possíveis." />
    {!novo && <div className="acoes"><button className="bt" onClick={() => setNovo(true)}>Nova pausa</button></div>}
    {novo && <FormPausa onDone={() => { setNovo(false); carregar(); }} />}
    <section className="cf-box">{!ps ? <p className="muted">Carregando…</p> :
      <Tabela cols={[{ t: "Cliente", destaque: true }, { t: "Contrato" }, { t: "Alcance" }, { t: "Mensagens" }, { t: "Até" }, { t: "Motivo", bloco: true }, { t: "Criada" }, { t: "" }]} vazio="Nenhuma pausa ativa."
        linhas={ps.map((p) => ({ k: p.id, c: [p.cliente, p.contrato, p.customerId ? "Cliente" : "Contrato", p.tipos, p.ate ? br(p.ate) : "sem prazo", p.motivo, `${quando(p.criadaEm)} · ${p.criadoPor}`, <button key="b" className="bt leve mini" onClick={() => remover(p.id)}>Remover</button>] }))} />}
    </section>
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
  const lig = (v: boolean) => v ? <span className="cf-st ok">Ligado</span> : <span className="cf-st">Desligado</span>;
  return <>
    <Cabecalho titulo="Régua automática" />
    <p className="sub">Todo dia às 08h30: boleto {cfg?.diasAntes ?? 10} dias antes, lembrete no vencimento e cobrança em D+{(cfg?.etapas ?? [1, 7, 15]).join("/D+")} — só parcelas com boleto gerado e em aberto, exceto clientes em pausa. Confirmação de pagamento às 12h e 18h.</p>
    {cfg && <section className="cf-box">
      <Tabela cols={[{ t: "Item", destaque: true }, { t: "Situação" }]} linhas={[
        { k: "m", c: ["Modo", cfg.reguaTeste ? <span className="cf-st al">Teste (só registra)</span> : <span className="cf-st ok">Enviando aos clientes</span>] },
        { k: "b", c: [`Boleto D-${cfg.diasAntes}`, lig(cfg.boleto)] }, { k: "l", c: ["Lembrete D0", lig(cfg.lembrete)] }, { k: "c", c: ["Cobrança", lig(cfg.cobranca)] },
        { k: "r", c: ["Relatório automático", <span key="r">{lig(cfg.relatorioAuto)} · {cfg.destinatariosRelatorio} destinatário(s)</span>] }, { k: "ca", c: ["Canal", cfg.canal] },
      ]} />
      <p className="muted" style={{ fontSize: ".8rem" }}>Estas chaves ficam nas variáveis do Railway (cron-regua).</p>
    </section>}
    <div className="acoes" style={{ marginTop: 12 }}>
      <button className="bt" disabled={rodando} onClick={() => exec("previa")}>Ver prévia de hoje</button>
      <button className="bt leve" disabled={rodando} onClick={() => exec("rodar")}>Rodar agora</button>
    </div>
    <p className="muted" style={{ fontSize: ".8rem" }}>Cada uma usa 1 das 20 consultas diárias ao Sienge.</p>
    {rodando && <p className="muted">Consultando o Sienge…</p>}
    {r?.erro && <div className="cf-banner erro">{r.erro}</div>}
    {r && !r.erro && <section className="cf-box">
      <p>Parcelas lidas: <b>{r.parcelasLidas}</b> · boleto {r.planejadas?.BOLETO} · lembrete {r.planejadas?.LEMBRETE_D0} · cobrança {r.planejadas?.COBRANCA} · já tratadas {r.jaTratadas} · mensagens {r.mensagens}</p>
      {r.skipped && <div className="cf-banner teste">{r.skipped}</div>}
      {Object.keys(r.porStatus ?? {}).length > 0 && <p>Resultado: {Object.entries(r.porStatus).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
      {r.pulados?.length > 0 && <details><summary>{r.pulados.length} parcela(s) puladas</summary><ul>{r.pulados.map((p: any, i: number) => <li key={i}>título {p.billId}/{p.installmentId} ({NOME_TIPO[p.tipo]}): {p.motivo}</li>)}</ul></details>}
      {r.previews?.map((p: any, i: number) => <details key={i} style={{ marginTop: 8 }}><summary>{NOME_TIPO[p.tipo]} — {p.nome} ({p.parcelas.length} parcela(s)){p.telefone ? "" : " · SEM TELEFONE"}</summary><div className="cf-msg" style={{ marginTop: 6 }}>{p.mensagem}</div></details>)}
    </section>}
  </>;
}

// ---------- Histórico ----------
function Historico() {
  const [f, setF] = useState({ tipo: "", status: "", dias: "7" }); const [ls, setLs] = useState<any[] | null>(null);
  useEffect(() => { setLs(null); api(`/api/painel/historico?${new URLSearchParams(f)}`).then(setLs).catch(() => setLs([])); }, [f]);
  return <>
    <Cabecalho titulo="Histórico" sub="Tudo o que o sistema enviou, tentou enviar ou registrou." />
    <div className="cf-filtros">
      <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} aria-label="Tipo"><option value="">Todos os tipos</option><option value="BOLETO">Boleto</option><option value="LEMBRETE_D0">Lembrete</option><option value="COBRANCA">Cobrança</option><option value="CONFIRMACAO">Confirmação</option><option value="RELATORIO_DIA">Relatório</option></select>
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Todos os status</option><option value="ENVIADA">Enviada</option><option value="SENT">Enviada (confirmação)</option><option value="DRY_RUN">Teste</option><option value="PLANEJADA">Aguardando</option><option value="ERRO">Erro</option><option value="SEM_WHATSAPP">Sem WhatsApp</option><option value="SEM_TELEFONE">Sem telefone</option><option value="INCERTA">Incerta</option></select>
      <select value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} aria-label="Período"><option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select>
    </div>
    <section className="cf-box">{!ls ? <p className="muted">Carregando…</p> :
      <Tabela cols={[{ t: "Tipo", destaque: true }, { t: "Quando" }, { t: "Cliente" }, { t: "Contrato" }, { t: "Valor", num: true }, { t: "Status" }, { t: "Por" }]} vazio="Nada no período."
        linhas={ls.map((l, i) => ({ k: `h${i}`, c: [tipoEtapa(l.tipo, l.etapa), quando(l.quando), l.cliente ?? "—", `${l.contrato ?? "—"}${l.parcela ? ` · ${l.parcela}` : ""}`, brl(l.valor), <Status key="s" s={l.status} motivo={l.motivo ?? l.detalhe} />, l.solicitadoPor] }))} />}
    </section>
  </>;
}

// ---------- Shell ----------
const ABAS: [Aba, string, string][] = [["hoje", "Hoje", "hoje"], ["clientes", "Clientes", "clientes"], ["inadimplencia", "Inadimplência", "inadimplencia"], ["pausas", "Pausas", "pausas"], ["regua", "Régua", "regua"], ["historico", "Histórico", "historico"]];

export default function Painel() {
  const [aba, setAba] = useState<Aba>("hoje");
  const [cliente, setCliente] = useState<number | null>(null);
  const [brain, setBrain] = useState(false);
  const ir = (k: Aba) => { setAba(k); if (k !== "clientes") setCliente(null); window.scrollTo({ top: 0 }); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setBrain(true); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return <div className="cf">
    <aside className="cf-side" aria-label="Menu">
      <img className="cf-side-logo" src="/marca/logo-claro.png" alt="Casa Forte Construtora" width={600} height={421} />
      <div className="cf-side-tit">Financeiro</div>
      <nav className="cf-side-nav">{ABAS.map(([k, r, i]) => <button key={k} className={aba === k ? "ativo" : ""} aria-current={aba === k ? "page" : undefined} onClick={() => ir(k)}><Icone n={i} /> {r}</button>)}</nav>
      <button className="cf-side-brain" onClick={() => setBrain(true)}>
        <span className="cf-brain-orb pequeno"><Icone n="brain" t={16} /></span>
        <span><b>Casa Forte Brain</b><small>Assistente com IA</small></span>
      </button>
    </aside>
    <header className="cf-top">
      <div className="cf-top-in">
        <img className="cf-top-logo" src="/marca/logo-claro.png" alt="Casa Forte" width={600} height={421} />
        <span className="cf-top-tit">Financeiro</span>
        <button className="cf-top-brain" onClick={() => setBrain(true)} aria-label="Casa Forte Brain"><Icone n="brain" t={18} /> Brain</button>
      </div>
      <nav className="cf-nav" aria-label="Seções">{ABAS.map(([k, r, i]) => <button key={k} className={aba === k ? "ativo" : ""} aria-current={aba === k ? "page" : undefined} onClick={() => ir(k)}><Icone n={i} t={16} /> {r}</button>)}</nav>
    </header>
    <div className="cf-area">
      <div className="cf-comando">
        <button className="cf-comando-in" onClick={() => setBrain(true)}>
          <Icone n="brain" t={18} className="cf-comando-ic" />
          <span>Pergunte ao Casa Forte Brain… <em>ex.: “quem está com mais de 15 dias de atraso?”</em></span>
          <kbd>⌘K</kbd>
        </button>
      </div>
      <main className="cf-main">
        {aba === "hoje" && <Hoje />}
        {aba === "clientes" && <Clientes abrirId={cliente} />}
        {aba === "inadimplencia" && <Inadimplencia abrirCliente={(id) => { ir("clientes"); setCliente(id); }} />}
        {aba === "pausas" && <Pausas />}
        {aba === "regua" && <Regua />}
        {aba === "historico" && <Historico />}
        <Rodape />
      </main>
    </div>
    {brain && <BrainModal onClose={() => setBrain(false)} />}
  </div>;
}
