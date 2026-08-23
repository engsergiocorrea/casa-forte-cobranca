import { db } from "@/lib/db";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";

type Stats = { customers: number; open: number; messages: number; failed: number; rules: { id: string; name: string; dayOffset: number; templateName: string; enabled: boolean }[] };

export default async function Home() {
  const e = env();
  // Resiliente: se o banco ainda não tiver as tabelas (migration pendente),
  // mostra o aviso em vez de derrubar a página com 500.
  let stats: Stats | null = null;
  try {
    const [customers, open, messages, failed, rules] = await Promise.all([
      db.customer.count(), db.installment.count({ where: { status: "OPEN" } }), db.message.count(),
      db.message.count({ where: { status: "FAILED" } }), db.collectionRule.findMany({ orderBy: { dayOffset: "asc" } })
    ]);
    stats = { customers, open, messages, failed, rules };
  } catch { stats = null; }

  return <main>
    <header><div><small>CASA FORTE</small><h1>Cobrança & Relacionamento</h1></div><span className={e.OUTBOUND_MESSAGING_ENABLED ? "pill on" : "pill off"}>{e.OUTBOUND_MESSAGING_ENABLED ? "ENVIO HABILITADO" : "ENVIO BLOQUEADO"}</span></header>
    {stats ? (
      <section className="grid">
        <article><b>{stats.customers}</b><span>Clientes sincronizados</span></article>
        <article><b>{stats.open}</b><span>Parcelas abertas</span></article>
        <article><b>{stats.messages}</b><span>Mensagens registradas</span></article>
        <article><b>{stats.failed}</b><span>Falhas</span></article>
      </section>
    ) : (
      <section className="panel"><h2>Banco de dados</h2><p>As tabelas ainda não estão criadas (migration pendente). O deploy aplica automaticamente — se este aviso persistir, verifique o log do serviço no Railway.</p></section>
    )}
    <section className="panel"><h2>Consultas</h2><p><a href="/consultas">Abrir consultas do Sienge (staging)</a> — status da conexão, clientes, contratos e títulos, com dados sensíveis mascarados.</p></section>
    <section className="panel"><h2>Segurança</h2><p>Ambiente: <strong>{e.APP_MODE}</strong> · Dry run: <strong>{String(e.WHATSAPP_DRY_RUN)}</strong> · Liberação geral em produção: <strong>{String(e.WHATSAPP_ALLOW_ALL_PRODUCTION)}</strong></p></section>
    {stats && (
      <section className="panel"><h2>Régua</h2><table><thead><tr><th>Regra</th><th>Offset</th><th>Template</th><th>Status</th></tr></thead><tbody>{stats.rules.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.dayOffset}</td><td>{r.templateName}</td><td>{r.enabled ? "Ativa" : "Desativada"}</td></tr>)}</tbody></table></section>
    )}
    <p className="note">v0.1: primeiro validar integração e payloads reais do Sienge. Não ativar régua para clientes antes do plano de testes.</p>
  </main>;
}
