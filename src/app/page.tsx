import { db } from "@/lib/db";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export default async function Home() {
  const [customers, open, messages, failed, rules] = await Promise.all([
    db.customer.count(), db.installment.count({ where: { status: "OPEN" } }), db.message.count(),
    db.message.count({ where: { status: "FAILED" } }), db.collectionRule.findMany({ orderBy: { dayOffset: "asc" } })
  ]);
  const e = env();
  return <main>
    <header><div><small>CASA FORTE</small><h1>Cobrança & Relacionamento</h1></div><span className={e.OUTBOUND_MESSAGING_ENABLED ? "pill on" : "pill off"}>{e.OUTBOUND_MESSAGING_ENABLED ? "ENVIO HABILITADO" : "ENVIO BLOQUEADO"}</span></header>
    <section className="grid">
      <article><b>{customers}</b><span>Clientes sincronizados</span></article>
      <article><b>{open}</b><span>Parcelas abertas</span></article>
      <article><b>{messages}</b><span>Mensagens registradas</span></article>
      <article><b>{failed}</b><span>Falhas</span></article>
    </section>
    <section className="panel"><h2>Segurança</h2><p>Ambiente: <strong>{e.APP_MODE}</strong> · Dry run: <strong>{String(e.WHATSAPP_DRY_RUN)}</strong> · Liberação geral em produção: <strong>{String(e.WHATSAPP_ALLOW_ALL_PRODUCTION)}</strong></p></section>
    <section className="panel"><h2>Régua</h2><table><thead><tr><th>Regra</th><th>Offset</th><th>Template</th><th>Status</th></tr></thead><tbody>{rules.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.dayOffset}</td><td>{r.templateName}</td><td>{r.enabled ? "Ativa" : "Desativada"}</td></tr>)}</tbody></table></section>
    <p className="note">v0.1: primeiro validar integração e payloads reais do Sienge. Não ativar régua para clientes antes do plano de testes.</p>
  </main>;
}
