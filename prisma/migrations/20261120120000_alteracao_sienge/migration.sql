-- CreateTable
CREATE TABLE "AlteracaoSienge" (
    "id" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "customerId" INTEGER,
    "billId" INTEGER,
    "installmentId" INTEGER,
    "antes" JSONB,
    "depois" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "detalhe" TEXT,
    "solicitadoPor" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlteracaoSienge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlteracaoSienge_customerId_idx" ON "AlteracaoSienge"("customerId");

-- CreateIndex
CREATE INDEX "AlteracaoSienge_billId_idx" ON "AlteracaoSienge"("billId");
