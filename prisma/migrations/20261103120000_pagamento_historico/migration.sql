-- CreateTable
CREATE TABLE "PagamentoHistorico" (
    "id" TEXT NOT NULL,
    "billId" INTEGER NOT NULL,
    "installmentId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "clientId" INTEGER,
    "parcela" TEXT NOT NULL,
    "vencimento" TEXT NOT NULL,
    "pagoEm" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "real" BOOLEAN NOT NULL,
    "bruto" DECIMAL(18,2) NOT NULL,
    "desconto" DECIMAL(18,2) NOT NULL,
    "juros" DECIMAL(18,2) NOT NULL,
    "multa" DECIMAL(18,2) NOT NULL,
    "liquido" DECIMAL(18,2) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagamentoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoSync" (
    "billId" INTEGER NOT NULL,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricoSync_pkey" PRIMARY KEY ("billId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoHistorico_billId_installmentId_seq_key" ON "PagamentoHistorico"("billId", "installmentId", "seq");

-- CreateIndex
CREATE INDEX "PagamentoHistorico_billId_idx" ON "PagamentoHistorico"("billId");

-- CreateIndex
CREATE INDEX "PagamentoHistorico_clientId_idx" ON "PagamentoHistorico"("clientId");
