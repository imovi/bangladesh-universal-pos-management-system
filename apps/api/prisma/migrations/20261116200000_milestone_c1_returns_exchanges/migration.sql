-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "sale_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "refund_method" TEXT NOT NULL,
    "total_refund_minor" BIGINT NOT NULL,
    "tax_refund_minor" BIGINT NOT NULL DEFAULT 0,
    "exchange_sale_id" UUID,
    "reason" TEXT,
    "override_reason" TEXT,
    "override_by_user_id" UUID,
    "request_payload_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_return_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_refund_minor" BIGINT NOT NULL,
    "tax_refund_minor" BIGINT NOT NULL DEFAULT 0,
    "total_refund_minor" BIGINT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'resellable',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenant_id_return_number_key" ON "sale_returns"("tenant_id", "return_number");
CREATE INDEX "sale_returns_tenant_id_idx" ON "sale_returns"("tenant_id");
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");
CREATE INDEX "sale_returns_shift_id_idx" ON "sale_returns"("shift_id");
CREATE INDEX "sale_returns_branch_id_idx" ON "sale_returns"("branch_id");
CREATE INDEX "sale_returns_created_at_idx" ON "sale_returns"("created_at");

-- CreateIndex
CREATE INDEX "sale_return_items_tenant_id_idx" ON "sale_return_items"("tenant_id");
CREATE INDEX "sale_return_items_sale_return_id_idx" ON "sale_return_items"("sale_return_id");
CREATE INDEX "sale_return_items_sale_item_id_idx" ON "sale_return_items"("sale_item_id");
CREATE INDEX "sale_return_items_variant_id_idx" ON "sale_return_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_counters_tenant_id_register_id_date_key_key" ON "return_counters"("tenant_id", "register_id", "date_key");
CREATE INDEX "return_counters_tenant_id_idx" ON "return_counters"("tenant_id");
CREATE INDEX "return_counters_register_id_idx" ON "return_counters"("register_id");

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_override_by_user_id_fkey" FOREIGN KEY ("override_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_exchange_sale_id_fkey" FOREIGN KEY ("exchange_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_counters" ADD CONSTRAINT "return_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_counters" ADD CONSTRAINT "return_counters_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "sale_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_returns" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sale_return_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_return_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "return_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "return_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "sale_returns"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "sale_return_items"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "return_counters"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sale_returns TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sale_return_items TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.return_counters TO pos_app;
