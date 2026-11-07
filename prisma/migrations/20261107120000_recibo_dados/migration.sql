-- AlterTable
ALTER TABLE "ParcelaCache" ADD COLUMN "companyId" INTEGER,
ADD COLUMN "companyName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PagamentoHistorico" ADD COLUMN "seguro" DECIMAL(18,2) NOT NULL DEFAULT 0;
