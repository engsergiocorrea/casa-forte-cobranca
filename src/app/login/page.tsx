import type { Metadata } from "next";
import Login from "./Login";

export const metadata: Metadata = { title: "Entrar · Casa Forte Financeiro" };
export const dynamic = "force-dynamic";
export default function Page() {
  return <Login />;
}
