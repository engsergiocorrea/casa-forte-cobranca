import "./styles.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Casa Forte · Financeiro",
  appleWebApp: { capable: true, title: "Financeiro", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};
// Celular: largura do aparelho, área segura do iPhone (notch/gesto) e cor da barra.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
