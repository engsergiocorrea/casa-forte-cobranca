import "./styles.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--fonte" });

export const metadata: Metadata = {
  title: "Casa Forte · Financeiro",
  description: "Comunicação financeira da Casa Forte — boletos, cobranças, confirmações e relatórios.",
  applicationName: "Casa Forte Financeiro",
  appleWebApp: { capable: true, title: "Financeiro", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false }, // sistema interno: fora dos buscadores
};
// Celular: largura do aparelho, área segura do iPhone (notch/gesto) e cor da barra.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0e1014" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={inter.variable}><body>{children}</body></html>;
}
