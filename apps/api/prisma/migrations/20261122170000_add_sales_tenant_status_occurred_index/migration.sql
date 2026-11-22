-- CreateIndex
CREATE INDEX IF NOT EXISTS "sales_tenant_id_status_occurred_at_idx" ON "sales"("tenant_id", "status", "occurred_at");
