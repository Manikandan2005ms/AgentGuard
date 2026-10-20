-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'payment',
ADD COLUMN     "toolArgs" JSONB,
ADD COLUMN     "toolName" TEXT,
ADD COLUMN     "toolResult" JSONB;
