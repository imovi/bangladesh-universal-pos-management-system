-- CreateTable stock_movements
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty_delta" DECIMAL(14,3) NOT NULL,
    "type" TEXT NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "reason" TEXT,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable stock_levels
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX "stock_movements_tenant_id_idx" ON "stock_movements"("tenant_id");
CREATE INDEX "stock_movements_branch_id_idx" ON "stock_movements"("branch_id");
CREATE INDEX "stock_movements_variant_id_idx" ON "stock_movements"("variant_id");
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");
CREATE INDEX "stock_movements_occurred_at_idx" ON "stock_movements"("occurred_at");

CREATE UNIQUE INDEX "stock_levels_tenant_id_branch_id_variant_id_key" ON "stock_levels"("tenant_id", "branch_id", "variant_id");
CREATE INDEX "stock_levels_tenant_id_idx" ON "stock_levels"("tenant_id");
CREATE INDEX "stock_levels_branch_id_idx" ON "stock_levels"("branch_id");
CREATE INDEX "stock_levels_variant_id_idx" ON "stock_levels"("variant_id");

-- Foreign Keys
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS) Grants & Policies for stock_movements (APPEND-ONLY)
GRANT SELECT, INSERT ON TABLE public.stock_movements TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.stock_movements FROM pos_app;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON public.stock_movements
    FOR ALL TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Row Level Security (RLS) Grants & Policies for stock_levels
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_levels TO pos_app;
ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON public.stock_levels
    FOR ALL TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);


