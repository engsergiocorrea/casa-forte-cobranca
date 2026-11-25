import type { Metadata } from "next";
import Corretor from "./Corretor";

export const metadata: Metadata = { title: "Minhas comissões · Casa Forte", robots: { index: false, follow: false } };

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  return <Corretor token={(await params).token} />;
}
