import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  // /consultas (ferramenta antiga de diagnóstico) saiu: tudo está no painel.
  async redirects() {
    return [{ source: "/consultas/:path*", destination: "/", permanent: false }];
  },
};
export default nextConfig;
