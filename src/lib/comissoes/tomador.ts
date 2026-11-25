// Para quem o corretor emite a NF/RPA (tomador = empresa vendedora do
// empreendimento). CONFERIR com a diretoria ao incluir empreendimento novo.
export type Tomador = { razaoSocial: string; cnpj: string };
const CASA_FORTE: Tomador = { razaoSocial: "CONSTRUÇÕES E EMPREENDIMENTOS CASA FORTE LTDA", cnpj: "37.301.810/0001-98" };
const UMA: Tomador = { razaoSocial: "UMÁ MILAGRES SPE LTDA", cnpj: "66.956.500/0001-00" };

export function tomadorDe(empreendimento: string | null | undefined): Tomador {
  const e = String(empreendimento ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (e.includes("UMA")) return UMA;
  return CASA_FORTE;
}
