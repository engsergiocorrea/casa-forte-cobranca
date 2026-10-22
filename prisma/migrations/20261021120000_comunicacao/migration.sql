-- CreateTable
CREATE TABLE "Comunicacao" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "etapa" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "billId" INTEGER,
    "installmentId" INTEGER,
    "dueDate" TIMESTAMP(3),
    "customerId" INTEGER,
    "clienteNome" TEXT,
    "contrato" TEXT,
    "parcela" TEXT,
    "valor" DECIMAL(18,2),
    "destino" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "canal" TEXT,
    "providerMessageId" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "detalhe" TEXT,
    "conteudo" TEXT,
    "solicitadoPor" TEXT NOT NULL DEFAULT 'cron',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadaEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comunicacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Comunicacao_dedupeKey_key" ON "Comunicacao"("dedupeKey");
CREATE INDEX "Comunicacao_status_idx" ON "Comunicacao"("status");
CREATE INDEX "Comunicacao_billId_installmentId_idx" ON "Comunicacao"("billId", "installmentId");
CREATE INDEX "Comunicacao_customerId_idx" ON "Comunicacao"("customerId");
CREATE INDEX "Comunicacao_criadaEm_idx" ON "Comunicacao"("criadaEm");
