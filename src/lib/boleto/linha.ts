// Dados gravados na própria linha digitável do boleto bancário (47 dígitos):
// campo 5 = fator de vencimento (4) + valor em centavos (10). Serve para
// conferir se o valor escrito na mensagem é o mesmo do boleto anexado.

const digitos = (linha: string | null | undefined) => String(linha ?? "").replace(/\D/g, "");

// Valor do boleto em reais, ou null (linha ausente/fora do padrão ou "valor em aberto").
export function valorDaLinha(linha: string | null | undefined): number | null {
  const d = digitos(linha);
  if (d.length !== 47) return null;
  const centavos = Number(d.slice(37));
  return centavos > 0 ? centavos / 100 : null;
}

// Vencimento do boleto (yyyy-mm-dd). Desde 22/02/2025 o fator recomeça em 1000.
export function vencimentoDaLinha(linha: string | null | undefined): string | null {
  const d = digitos(linha);
  if (d.length !== 47) return null;
  const fator = Number(d.slice(33, 37));
  if (!fator) return null;
  const base = Date.UTC(2025, 1, 22) + (fator - 1000) * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}
