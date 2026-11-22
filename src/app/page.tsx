import Painel from "./painel/Painel";

// Painel do financeiro — cobranca.casaforteinc.com.br (protegido pelo Basic
// login do painel / login único).
export const dynamic = "force-dynamic";
export default function Home() {
  return <Painel />;
}
