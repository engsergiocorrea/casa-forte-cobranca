import "./styles.css";
export const metadata = { title: "Casa Forte · Financeiro" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>{children}</body></html>;
}
