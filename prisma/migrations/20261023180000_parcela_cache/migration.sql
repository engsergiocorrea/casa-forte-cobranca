-- CreateTable
CREATE TABLE "ParcelaCache" (
    "billId" INTEGER NOT NULL,
    "installmentId" INTEGER NOT NULL,
    "parcela" TEXT NOT NULL,
    "tipoParc" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "centroCusto" TEXT NOT NULL,
    "vencimento" TEXT NOT NULL,
    "clientId" INTEGER,
    "clientName" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelaCache_pkey" PRIMARY KEY ("billId","installmentId")
);

-- CreateIndex
CREATE INDEX "ParcelaCache_clientId_idx" ON "ParcelaCache"("clientId");
