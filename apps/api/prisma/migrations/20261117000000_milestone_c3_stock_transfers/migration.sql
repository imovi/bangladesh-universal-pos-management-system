-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "source_branch_id" UUID NOT NULL,
    "destination_branch_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "sent_by_user_id" UUID,
    "received_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sent_qty" DECIMAL(14,3) NOT NULL,
    "received_qty" DECIMAL(14,3),
    "loss_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "loss_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_transfer_number_key" ON "stock_transfers"("tenant_id", "transfer_number");
CREATE INDEX "stock_transfers_tenant_id_idx" ON "stock_transfers"("tenant_id");
CREATE INDEX "stock_transfers_source_branch_id_idx" ON "stock_transfers"("source_branch_id");
CREATE INDEX "stock_transfers_destination_branch_id_idx" ON "stock_transfers"("destination_branch_id");
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");
CREATE INDEX "stock_transfers_created_at_idx" ON "stock_transfers"("created_at");

-- CreateIndex
CREATE INDEX "stock_transfer_items_tenant_id_idx" ON "stock_transfer_items"("tenant_id");
CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");
CREATE INDEX "stock_transfer_items_variant_id_idx" ON "stock_transfer_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_counters_tenant_id_date_key_key" ON "transfer_counters"("tenant_id", "date_key");
CREATE INDEX "transfer_counters_tenant_id_idx" ON "transfer_counters"("tenant_id");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_counters" ADD CONSTRAINT "transfer_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "transfer_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "stock_transfers"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "stock_transfer_items"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "transfer_counters"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_transfers TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_transfer_items TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transfer_counters TO pos_app;
