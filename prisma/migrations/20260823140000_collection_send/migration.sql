-- CreateTable
CREATE TABLE "CollectionSend" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "billId" INTEGER NOT NULL,
    "installmentId" INTEGER NOT NULL,
    "etapa" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "motivo" TEXT,
    "messageId" TEXT,
    "boletoSent" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSend_dedupeKey_key" ON "CollectionSend"("dedupeKey");

-- CreateIndex
CREATE INDEX "CollectionSend_billId_installmentId_etapa_idx" ON "CollectionSend"("billId", "installmentId", "etapa");

-- CreateIndex
CREATE INDEX "CollectionSend_createdAt_idx" ON "CollectionSend"("createdAt");

