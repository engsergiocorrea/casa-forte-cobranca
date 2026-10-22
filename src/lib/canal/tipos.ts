// Contrato entre a regra de negócio e o canal de WhatsApp.
// A regra monta UMA MensagemPadrao (modelo + variáveis + anexo); cada canal
// decide como enviar: a Evolution renderiza texto livre, a Meta usará o
// template aprovado com o mesmo nome. Trocar de canal não muda regra nenhuma.
// Ver docs/ARQUITETURA-COMUNICACAO.md §4.4.

export type ModeloMensagem = "boleto_mes" | "lembrete_vencimento" | "cobranca_atraso";

// Um item = uma parcela listada na mensagem (cliente com várias parcelas no
// mesmo dia recebe UMA mensagem com todas).
export type ItemParcela = {
  parcela: string;        // "4/60"
  imovel: string;         // "UMÁ MILAGRES — R - 211"
  vencimento: string;     // dd/mm/aaaa
  valor: string;          // "R$ 4.084,72"
  boletoUrl?: string | null;
  linhaDigitavel?: string | null;
};

export type MensagemPadrao = {
  modelo: ModeloMensagem;
  nome: string;           // primeiro nome do cliente
  itens: ItemParcela[];
  diasAtraso?: number;    // cobranca_atraso
  // Anexo opcional (ex.: PDF do boleto). URL pública OU base64.
  anexo?: { nomeArquivo: string; url?: string; base64?: string } | null;
};

export type ResultadoEnvio = {
  sucesso: boolean;
  providerMessageId: string | null;
  erro?: string;
  incerto?: boolean;      // timeout/conexão: pode ter saído — nunca reenviar sozinho
};

export interface CanalWhatsApp {
  nome: "evolution" | "meta";
  numeroTemWhatsApp(e164: string): Promise<boolean | null>;
  enviar(msg: MensagemPadrao, paraE164: string): Promise<ResultadoEnvio>;
}
