-- CreateTable
CREATE TABLE "PausaRegua" (
    "id" TEXT NOT NULL,
    "customerId" INTEGER,
    "billId" INTEGER,
    "contrato" TEXT,
    "clienteNome" TEXT,
    "tipos" TEXT NOT NULL DEFAULT 'TODOS',
    "ate" TIMESTAMP(3),
    "motivo" TEXT NOT NULL,
    "criadoPor" TEXT NOT NULL DEFAULT 'manual',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removidaEm" TIMESTAMP(3),

    CONSTRAINT "PausaRegua_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PausaRegua_customerId_idx" ON "PausaRegua"("customerId");
CREATE INDEX "PausaRegua_billId_idx" ON "PausaRegua"("billId");
