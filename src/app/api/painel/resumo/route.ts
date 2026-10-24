import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { localDateKey } from "@/lib/collection/date";
import { coletarRelatorio, destinatariosRelatorio } from "@/lib/relatorio/enviar";
import { usuarioPainel } from "@/lib/painel/auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const e = env();
  const d = req.nextUrl.searchParams.get("data");
  const data = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localDateKey(new Date(), e.TIMEZONE);
  return NextResponse.json({
    usuario: a.usuario, data,
    config: {
      envioLigado: e.OUTBOUND_MESSAGING_ENABLED, whatsappTeste: e.WHATSAPP_DRY_RUN, reguaTeste: e.REGUA_DRY_RUN,
      boleto: e.BOLETO_ENABLED, lembrete: e.LEMBRETE_ENABLED, cobranca: e.COBRANCA_ENABLED,
      etapas: e.COBRANCA_ETAPAS, diasAntes: e.BOLETO_DIAS_ANTES,
      relatorioAuto: e.REPORT_AUTO_ENABLED, destinatariosRelatorio: destinatariosRelatorio().length,
      canal: e.WHATSAPP_PROVIDER,
    },
    relatorio: await coletarRelatorio(data),
  });
}
