"use client";
import { useEffect, useRef, useState } from "react";

// Tela de login do painel do financeiro (substitui o pop-up do navegador).
// Identidade Casa Forte, padrão Apple: vidro escuro, resposta no toque,
// foco visível, 16px nos campos (sem zoom no iPhone), movimento reduzido.
export default function Login() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setEntrando(true);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, senha, lembrar }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível entrar."); setEntrando(false); return; }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
    } catch { setErro("Sem conexão. Tente de novo."); setEntrando(false); }
  }

  return (
    <div className="lg">
      <div className="lg-aura" aria-hidden="true" />
      <main className="lg-card">
        <img className="lg-logo" src="/marca/logo-claro.png" alt="Casa Forte Construtora" width={600} height={421} />
        <h1>Financeiro</h1>
        <p className="lg-sub">Cobrança, inadimplência, fluxo de caixa e o braIAn.</p>
        <form onSubmit={entrar} noValidate>
          <label className="lg-campo">
            <span>Usuário</span>
            <input ref={campo} value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label className="lg-campo">
            <span>Senha</span>
            <div className="lg-senha">
              <input type={ver ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
              <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar senha" : "Mostrar senha"}>{ver ? "Ocultar" : "Mostrar"}</button>
            </div>
          </label>
          <label className="lg-lembrar">
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
            Manter conectado neste aparelho por 30 dias
          </label>
          {erro && <p className="lg-erro" role="alert">{erro}</p>}
          <button className="lg-entrar" type="submit" disabled={entrando || !usuario || !senha}>{entrando ? "Entrando…" : "Entrar"}</button>
        </form>
        <p className="lg-rodape">Sistema interno de uso restrito · acessos são registrados.</p>
      </main>
      <footer className="lg-copy">© {new Date().getFullYear()} Construções e Empreendimentos Casa Forte Ltda.</footer>
    </div>
  );
}
