"use client";
import { useCallback, useEffect, useState } from "react";

// Página do link do corretor: confere as comissões, cola os próprios dados
// (CPF/CNPJ, CRECI, PIX), copia as informações para emitir a nota e envia a NF/RPA.

type Dados = { nome: string; creci: string | null; documento: string | null; email: string | null; telefone: string | null; pixTipo: string | null; pixChave: string | null; banco: string | null };
type Com = { id: string; status: string; statusTexto: string; venda: string; contrato: string | null; cliente: string | null; valor: number | null; liberadaEm: string | null; pagaEm: string | null; nfNumero: string | null; nfEnviadaEm: string | null; tomador: { razaoSocial: string; cnpj: string }; descricaoNf: string; arquivos: { id: string; tipo: string; nome: string }[] };

const brl = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const valorNf = (n: number | null) => (n == null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Maceio" }) : "");
const TOM: Record<string, string> = { A_LIBERAR: "al", DISPONIVEL: "ok", PAGA: "pg", CANCELADA: "cn" };

function Copiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(valor); }
    catch { const t = document.createElement("textarea"); t.value = valor; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    setOk(true); setTimeout(() => setOk(false), 1600);
  }
  return <div className="cp">
    <div className="cp-txt"><span>{rotulo}</span><b>{valor}</b></div>
    <button type="button" onClick={copiar} className={ok ? "feito" : ""} aria-label={`Copiar ${rotulo}`}>{ok ? "Copiado ✓" : "Copiar"}</button>
  </div>;
}

function arquivoBase64(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f); });
}

function EnviarNf({ token, c, onOk }: { token: string; c: Com; onOk: () => void }) {
  const [numero, setNumero] = useState(c.nfNumero ?? ""); const [arq, setArq] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false); const [erro, setErro] = useState("");
  async function enviar() {
    setErro(""); setEnviando(true);
    try {
      const arquivo = arq ? { nome: arq.name, mime: arq.type || "application/pdf", base64: await arquivoBase64(arq) } : null;
      const r = await fetch(`/api/corretor/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "nf", comissaoId: c.id, nfNumero: numero, arquivo }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.erro ?? "Não foi possível enviar.");
      setArq(null); onOk();
    } catch (e: any) { setErro(e.message); }
    setEnviando(false);
  }
  return <div className="nf">
    <label>Número da nota / RPA<input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 1234" inputMode="text" /></label>
    <label className="arq">{arq ? `📎 ${arq.name}` : "Anexar PDF ou foto da nota"}<input type="file" accept="application/pdf,image/*" onChange={(e) => setArq(e.target.files?.[0] ?? null)} /></label>
    {erro && <p className="erro">{erro}</p>}
    <button className="bt" disabled={enviando || (!numero.trim() && !arq)} onClick={enviar}>{enviando ? "Enviando…" : c.nfEnviadaEm ? "Enviar outra nota" : "Enviar nota"}</button>
  </div>;
}

function MeusDados({ token, d, onOk }: { token: string; d: Dados; onOk: () => void }) {
  const [f, setF] = useState({ documento: d.documento ?? "", creci: d.creci ?? "", email: d.email ?? "", telefone: d.telefone ?? "", pixTipo: d.pixTipo ?? "CPF", pixChave: d.pixChave ?? "", banco: d.banco ?? "" });
  const [salvando, setSalvando] = useState(false); const [msg, setMsg] = useState(""); const [erro, setErro] = useState("");
  const campo = (k: keyof typeof f, rotulo: string, extra: Record<string, string> = {}) =>
    <label>{rotulo}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>;
  async function salvar() {
    setErro(""); setMsg(""); setSalvando(true);
    try {
      const r = await fetch(`/api/corretor/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "dados", ...f }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.erro ?? "Não foi possível salvar.");
      setMsg("Dados salvos ✓"); onOk();
    } catch (e: any) { setErro(e.message); }
    setSalvando(false);
  }
  return <section className="card">
    <h2>Meus dados para pagamento</h2>
    <p className="sub">Cole aqui seus dados. Eles são usados só para pagar suas comissões.</p>
    <div className="form">
      {campo("documento", "CPF ou CNPJ", { inputMode: "numeric", placeholder: "Somente números" })}
      {campo("creci", "CRECI")}
      <label>Tipo da chave PIX<select value={f.pixTipo} onChange={(e) => setF({ ...f, pixTipo: e.target.value })}>
        <option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="TELEFONE">Telefone</option><option value="EMAIL">E-mail</option><option value="ALEATORIA">Chave aleatória</option>
      </select></label>
      {campo("pixChave", "Chave PIX", { placeholder: "Cole sua chave" })}
      {campo("email", "E-mail", { inputMode: "email" })}
      {campo("telefone", "WhatsApp", { inputMode: "tel" })}
      <label className="largo">Banco, agência e conta (opcional)<input value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} placeholder="Ex.: Bradesco · ag 1234 · cc 56789-0" /></label>
    </div>
    {erro && <p className="erro">{erro}</p>}{msg && <p className="okmsg">{msg}</p>}
    <button className="bt" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar meus dados"}</button>
  </section>;
}

const DEMO: { corretor: Dados; comissoes: Com[] } = {
  corretor: { nome: "Antonio Carlos Exemplo", creci: "4074", documento: null, email: null, telefone: "+5582999990000", pixTipo: null, pixChave: null, banco: null },
  comissoes: [
    { id: "c1", status: "DISPONIVEL", statusTexto: "Liberada — envie a NF/RPA", venda: "CASA 102 – Casas Santorini", contrato: "SANTORINI102", cliente: "CLIENTE EXEMPLO", valor: 47628, liberadaEm: new Date().toISOString(), pagaEm: null, nfNumero: null, nfEnviadaEm: null, tomador: { razaoSocial: "CONSTRUÇÕES E EMPREENDIMENTOS CASA FORTE LTDA", cnpj: "37.301.810/0001-98" }, descricaoNf: "Comissão de corretagem referente à venda da unidade CASA 102 do empreendimento Casas Santorini, contrato SANTORINI102, cliente CLIENTE EXEMPLO.", arquivos: [] },
    { id: "c2", status: "A_LIBERAR", statusTexto: "Aguardando o sinal do cliente", venda: "CASA 108 – Casas Santorini", contrato: "SANTORINI108", cliente: "LUCAS EXEMPLO", valor: 44400, liberadaEm: null, pagaEm: null, nfNumero: null, nfEnviadaEm: null, tomador: { razaoSocial: "CONSTRUÇÕES E EMPREENDIMENTOS CASA FORTE LTDA", cnpj: "37.301.810/0001-98" }, descricaoNf: "", arquivos: [] },
  ],
};

export default function Corretor({ token }: { token: string }) {
  const [d, setD] = useState<{ corretor: Dados; comissoes: Com[] } | null>(null); const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    if (token === "demo" && window.location.hostname === "localhost") { setD(DEMO); return; } // só para conferir o visual em dev
    fetch(`/api/corretor/${token}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.erro ?? "Link inválido."); setD(j); }).catch((e) => setErro(e.message));
  }, [token]);
  useEffect(carregar, [carregar]);

  const abertas = d?.comissoes.filter((c) => c.status === "DISPONIVEL" || c.status === "A_LIBERAR") ?? [];
  const pagas = d?.comissoes.filter((c) => c.status === "PAGA") ?? [];
  const aReceber = d?.comissoes.filter((c) => c.status === "DISPONIVEL").reduce((s, c) => s + (c.valor ?? 0), 0) ?? 0;
  const semPix = d && !d.corretor.pixChave;

  return <main className="cr">
    <header>
      <img src="/marca/logo.png" alt="Casa Forte" height={34} onError={(e) => ((e.currentTarget.style.display = "none"))} />
      <span>Comissões</span>
    </header>
    {erro && <section className="card"><h1>Link inválido</h1><p className="sub">{erro} Peça um novo link à Casa Forte.</p></section>}
    {!d && !erro && <p className="sub" style={{ textAlign: "center", marginTop: 40 }}>Carregando…</p>}
    {d && <>
      <h1>Olá, {d.corretor.nome.split(" ")[0]}!</h1>
      <div className="resumo">
        <div><span>Liberado para você</span><b>{brl(aReceber)}</b></div>
        <div><span>Vendas em acompanhamento</span><b>{abertas.length}</b></div>
      </div>
      {semPix && <div className="aviso">Cadastre sua chave PIX em <b>Meus dados</b> (abaixo) para receber.</div>}

      {abertas.map((c) => <section key={c.id} className="card">
        <div className="topo"><div><h2>{c.venda || c.contrato}</h2><p className="sub">{c.cliente ?? ""}{c.contrato ? ` · ${c.contrato}` : ""}</p></div><span className={`st ${TOM[c.status] ?? ""}`}>{c.statusTexto}</span></div>
        <div className="valor">{brl(c.valor)}</div>
        {c.status === "A_LIBERAR" && <p className="sub">Sua comissão é liberada assim que o cliente quitar o sinal. Você recebe um aviso no WhatsApp.</p>}
        {c.status === "DISPONIVEL" && <>
          <p className="sub">Liberada em {data(c.liberadaEm)}. Emita a nota com os dados abaixo e envie aqui:</p>
          <div className="copias">
            <Copiar rotulo="Tomador (razão social)" valor={c.tomador.razaoSocial} />
            <Copiar rotulo="CNPJ do tomador" valor={c.tomador.cnpj} />
            <Copiar rotulo="Valor" valor={valorNf(c.valor)} />
            <Copiar rotulo="Descrição do serviço" valor={c.descricaoNf} />
          </div>
          {c.nfEnviadaEm && <p className="okmsg">Nota recebida em {data(c.nfEnviadaEm)}{c.nfNumero ? ` (nº ${c.nfNumero})` : ""}. O financeiro já foi avisado.</p>}
          <EnviarNf token={token} c={c} onOk={carregar} />
        </>}
      </section>)}

      {pagas.length > 0 && <section className="card">
        <h2>Pagas</h2>
        {pagas.map((c) => <div key={c.id} className="linha">
          <div><b>{c.venda || c.contrato}</b><span>{brl(c.valor)} · paga em {data(c.pagaEm)}</span></div>
          {c.arquivos.filter((a) => a.tipo === "COMPROVANTE").map((a) => <a key={a.id} href={`/api/corretor/${token}?arquivo=${a.id}`} target="_blank" rel="noreferrer">Comprovante</a>)}
        </div>)}
      </section>}

      {abertas.length === 0 && pagas.length === 0 && <section className="card"><p className="sub">Nenhuma comissão por aqui ainda. Quando uma venda sua for assinada, ela aparece nesta página.</p></section>}

      <MeusDados token={token} d={d.corretor} onOk={carregar} />
      <p className="rodape">Este link é pessoal — não compartilhe. Dúvidas: fale com o financeiro da Casa Forte.</p>
    </>}
    <style>{`
      .cr{max-width:560px;margin:0 auto;padding:calc(16px + env(safe-area-inset-top)) 16px 40px;font-family:var(--fonte),-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased}
      body{background:#f5f5f7}
      .cr header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
      .cr header span{font-size:.8rem;font-weight:600;color:#6e6e73;letter-spacing:.02em}
      .cr h1{font-size:1.75rem;letter-spacing:-.02em;margin:0 0 14px}
      .cr h2{font-size:1.05rem;margin:0;letter-spacing:-.01em}
      .sub{color:#6e6e73;font-size:.9rem;line-height:1.45;margin:4px 0 0}
      .card{background:#fff;border-radius:18px;padding:18px;margin-top:14px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 0 0 .5px rgba(0,0,0,.05)}
      .resumo{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .resumo div{background:#fff;border-radius:16px;padding:14px;box-shadow:0 0 0 .5px rgba(0,0,0,.06)}
      .resumo span{display:block;font-size:.75rem;color:#6e6e73}.resumo b{font-size:1.3rem;letter-spacing:-.02em}
      .aviso{margin-top:12px;background:#fff4e5;color:#8a4b00;border-radius:12px;padding:11px 13px;font-size:.88rem}
      .topo{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .valor{font-size:1.9rem;font-weight:700;letter-spacing:-.03em;margin:10px 0 2px}
      .st{flex-shrink:0;font-size:.72rem;font-weight:600;padding:4px 9px;border-radius:999px;background:#eef0f3;color:#4b505b;text-align:center}
      .st.al{background:#fff4e5;color:#8a4b00}.st.ok{background:#e6f6ec;color:#1b7a3d}.st.pg{background:#e8f0fe;color:#1a56c4}
      .copias{display:grid;gap:8px;margin:12px 0}
      .cp{display:flex;align-items:center;gap:10px;background:#f5f5f7;border-radius:12px;padding:10px 10px 10px 12px}
      .cp-txt{flex:1;min-width:0}.cp-txt span{display:block;font-size:.7rem;color:#6e6e73}.cp-txt b{display:block;font-size:.9rem;font-weight:500;word-break:break-word}
      .cp button{flex-shrink:0;border:0;background:#fff;color:#E8390E;font-weight:600;font-size:.82rem;border-radius:9px;padding:9px 12px;min-height:38px;box-shadow:0 0 0 .5px rgba(0,0,0,.08);transition:transform 120ms ease,background-color 150ms ease}
      .cp button:active{transform:scale(.96)}.cp button.feito{background:#e6f6ec;color:#1b7a3d}
      .form,.nf{display:grid;gap:10px;margin:12px 0}
      .form{grid-template-columns:1fr 1fr}.form .largo{grid-column:1/-1}
      label{display:flex;flex-direction:column;gap:5px;font-size:.75rem;font-weight:600;color:#6e6e73}
      input,select{font:inherit;font-size:16px;color:#1d1d1f;border:1px solid #d2d2d7;border-radius:11px;padding:11px 12px;background:#fff;width:100%}
      input:focus,select:focus{outline:2px solid rgba(232,57,14,.35);border-color:#E8390E}
      .arq{position:relative;align-items:center;justify-content:center;border:1.5px dashed #d2d2d7;border-radius:12px;padding:14px;color:#1d1d1f;font-size:.88rem;font-weight:500;cursor:pointer}
      .arq input{position:absolute;inset:0;opacity:0;cursor:pointer}
      .bt{width:100%;border:0;background:#E8390E;color:#fff;font-weight:600;font-size:1rem;border-radius:12px;padding:13px;min-height:48px;transition:transform 120ms ease,opacity 150ms ease}
      .bt:active{transform:scale(.98)}.bt:disabled{opacity:.45}
      .erro{color:#c62828;font-size:.85rem;margin:0}.okmsg{color:#1b7a3d;font-size:.85rem;margin:8px 0 0}
      .linha{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:.5px solid #e5e5ea}
      .linha:first-of-type{border-top:0}.linha span{display:block;font-size:.82rem;color:#6e6e73}
      .linha a{color:#E8390E;font-weight:600;font-size:.85rem;flex-shrink:0}
      .rodape{text-align:center;color:#8e8e93;font-size:.75rem;margin-top:24px}
      @media(max-width:420px){.form{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.cp button,.bt{transition:none}}
    `}</style>
  </main>;
}
