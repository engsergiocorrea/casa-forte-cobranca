"use client";
import { useEffect, useState } from "react";

// Página de acompanhamento e consultas do Sienge (staging).
// Tudo READ-ONLY e com PII redigida no servidor. Protegida pelo Basic Auth do
// middleware (DASHBOARD_BASIC_USER/PASS).

type PingRes = { httpStatus: number; ok: boolean; count: number | null };

export default function ConsultasPage() {
  const [status, setStatus] = useState<{ customers: PingRes; contracts: PingRes; units: PingRes } | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [resultLabel, setResultLabel] = useState("");
  const [erro, setErro] = useState("");
  const [custId, setCustId] = useState("");
  const [contractId, setContractId] = useState("");
  const [billId, setBillId] = useState("");
  const [installmentId, setInstallmentId] = useState("");

  useEffect(() => {
    fetch("/api/consultas/sienge?action=status")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
        setStatus(d.status);
      })
      .catch((e) => setStatusErr(String(e?.message ?? e)));
  }, []);

  async function consultar(params: string, label: string) {
    setLoading(true); setErro(""); setResult(null); setResultLabel(label);
    try {
      const r = await fetch(`/api/consultas/sienge?${params}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
      setResult(d);
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const chip = (label: string, p?: PingRes) => (
    <span className={p?.ok ? "pill on" : "pill off"} style={{ marginRight: 8 }}>
      {label}: {p ? (p.ok ? `OK (${p.count ?? "?"})` : `HTTP ${p.httpStatus}`) : "…"}
    </span>
  );

  return (
    <main>
      <header>
        <div>
          <small>CASA FORTE · STAGING</small>
          <h1>Consultas Sienge</h1>
        </div>
        <a href="/" style={{ fontSize: 14 }}>← Dashboard</a>
      </header>

      <section className="panel">
        <h2>Conexão</h2>
        {statusErr
          ? <p style={{ color: "#8d1c0f" }}>{statusErr}</p>
          : <p>{chip("Clientes", status?.customers)}{chip("Contratos", status?.contracts)}{chip("Unidades", status?.units)}</p>}
        <p className="note">Somente leitura. CPF/CNPJ, e-mails e telefones aparecem mascarados.</p>
      </section>

      <section className="panel">
        <h2>Listagens</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => consultar("action=customers&limit=10", "Clientes (10 primeiros)")}>Listar clientes</button>
          <button onClick={() => consultar("action=sales-contracts&limit=10", "Contratos (10 primeiros)")}>Listar contratos</button>
          <button onClick={() => consultar("action=units&limit=10", "Unidades (10 primeiras)")}>Listar unidades</button>
        </div>
      </section>

      <section className="panel">
        <h2>Consulta pontual</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="ID do cliente" value={custId} onChange={(e) => setCustId(e.target.value)} inputMode="numeric" />
            <button disabled={!custId} onClick={() => consultar(`action=customer&id=${encodeURIComponent(custId)}`, `Cliente ${custId}`)}>Buscar cliente</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="ID do contrato" value={contractId} onChange={(e) => setContractId(e.target.value)} inputMode="numeric" />
            <button disabled={!contractId} onClick={() => consultar(`action=contract&id=${encodeURIComponent(contractId)}`, `Contrato ${contractId}`)}>Buscar contrato</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="billReceivableId (título)" value={billId} onChange={(e) => setBillId(e.target.value)} inputMode="numeric" />
            <input placeholder="installmentId (opcional)" value={installmentId} onChange={(e) => setInstallmentId(e.target.value)} inputMode="numeric" />
            <button disabled={!billId} onClick={() => consultar(`action=bill&billId=${encodeURIComponent(billId)}${installmentId ? `&installmentId=${encodeURIComponent(installmentId)}` : ""}`, `Título ${billId}`)}>Buscar título</button>
          </div>
        </div>
      </section>

      {loading && <section className="panel"><p>Consultando o Sienge…</p></section>}
      {erro && <section className="panel"><h2>Erro</h2><p style={{ color: "#8d1c0f" }}>{erro}</p></section>}

      {result && (
        <section className="panel">
          <h2>{resultLabel}</h2>
          {typeof result.count === "number" && <p>Total reportado pelo Sienge: <strong>{result.count}</strong></p>}
          {result.normalized && (
            <>
              <h3 style={{ marginBottom: 4 }}>Visão normalizada (mapper defensivo)</h3>
              <pre className="payload">{JSON.stringify(result.normalized, null, 2)}</pre>
              <h3 style={{ marginBottom: 4 }}>Payload bruto (redigido)</h3>
            </>
          )}
          <pre className="payload">{JSON.stringify(result.payload, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
