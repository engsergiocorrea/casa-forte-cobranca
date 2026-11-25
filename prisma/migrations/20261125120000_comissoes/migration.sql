-- Comissões de corretores (ver schema.prisma).
CREATE TABLE "Corretor" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "creci" TEXT,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "pixTipo" TEXT,
    "pixChave" TEXT,
    "banco" TEXT,
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dadosAtualizadosEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Corretor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Corretor_token_key" ON "Corretor"("token");
CREATE INDEX "Corretor_creci_idx" ON "Corretor"("creci");

CREATE TABLE "Comissao" (
    "id" TEXT NOT NULL,
    "corretorId" TEXT,
    "corretorNome" TEXT,
    "siengeContractId" INTEGER,
    "contratoNumero" TEXT,
    "empreendimento" TEXT,
    "unidade" TEXT,
    "clienteNome" TEXT,
    "valorVenda" DECIMAL(18,2),
    "valor" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'A_LIBERAR',
    "origem" TEXT NOT NULL,
    "contratosId" TEXT,
    "sinalTotal" DECIMAL(18,2),
    "sinalPago" DECIMAL(18,2),
    "verificadoEm" TIMESTAMP(3),
    "liberadaEm" TIMESTAMP(3),
    "pagaEm" TIMESTAMP(3),
    "pagaPor" TEXT,
    "nfNumero" TEXT,
    "nfEnviadaEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Comissao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Comissao_siengeContractId_key" ON "Comissao"("siengeContractId");
CREATE UNIQUE INDEX "Comissao_contratosId_key" ON "Comissao"("contratosId");
CREATE INDEX "Comissao_status_idx" ON "Comissao"("status");
CREATE INDEX "Comissao_corretorId_idx" ON "Comissao"("corretorId");
ALTER TABLE "Comissao" ADD CONSTRAINT "Comissao_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "Corretor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ComissaoArquivo" (
    "id" TEXT NOT NULL,
    "comissaoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "dados" BYTEA NOT NULL,
    "enviadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComissaoArquivo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComissaoArquivo_comissaoId_idx" ON "ComissaoArquivo"("comissaoId");
ALTER TABLE "ComissaoArquivo" ADD CONSTRAINT "ComissaoArquivo_comissaoId_fkey" FOREIGN KEY ("comissaoId") REFERENCES "Comissao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
