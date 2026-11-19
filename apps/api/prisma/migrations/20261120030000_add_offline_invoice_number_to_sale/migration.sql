-- AlterTable
ALTER TABLE "sales" ADD COLUMN "offline_invoice_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_offline_invoice_number_key" ON "sales"("tenant_id", "offline_invoice_number");

-- Grant column-level UPDATE permission for lost-response linking
GRANT UPDATE (offline_invoice_number) ON TABLE public.sales TO pos_app;
GRANT UPDATE (offline_invoice_number) ON TABLE public.sales TO pos_runtime;
