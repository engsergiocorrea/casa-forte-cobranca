-- CreateTable
CREATE TABLE "PaymentConfirmation" (
    "id" TEXT NOT NULL,
    "billId" INTEGER NOT NULL,
    "installmentId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "contrato" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "movementIds" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "motivo" TEXT,
    "messageId" TEXT,
    "detail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfirmation_billId_installmentId_key" ON "PaymentConfirmation"("billId", "installmentId");

-- CreateIndex
CREATE INDEX "PaymentConfirmation_clientId_idx" ON "PaymentConfirmation"("clientId");

-- CreateIndex
CREATE INDEX "PaymentConfirmation_status_idx" ON "PaymentConfirmation"("status");
