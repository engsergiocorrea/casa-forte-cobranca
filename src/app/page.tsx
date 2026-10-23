import Painel from "./painel/Painel";

// Painel do financeiro — cobranca.casaforteinc.com.br (protegido pelo Basic
// Auth do middleware). Ferramentas antigas de diagnóstico: /consultas.
export const dynamic = "force-dynamic";
export default function Home() {
  return <Painel />;
}
