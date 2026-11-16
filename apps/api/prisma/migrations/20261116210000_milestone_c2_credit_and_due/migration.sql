-- AlterTable
ALTER TABLE "customers" ADD COLUMN "credit_limit_minor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "due_minor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "received_by_user_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payment_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_payment_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_tenant_id_payment_number_key" ON "customer_payments"("tenant_id", "payment_number");
CREATE INDEX "customer_payments_tenant_id_idx" ON "customer_payments"("tenant_id");
CREATE INDEX "customer_payments_customer_id_idx" ON "customer_payments"("customer_id");
CREATE INDEX "customer_payments_shift_id_idx" ON "customer_payments"("shift_id");
CREATE INDEX "customer_payments_branch_id_idx" ON "customer_payments"("branch_id");
CREATE INDEX "customer_payments_created_at_idx" ON "customer_payments"("created_at");

-- CreateIndex
CREATE INDEX "customer_payment_allocations_tenant_id_idx" ON "customer_payment_allocations"("tenant_id");
CREATE INDEX "customer_payment_allocations_payment_id_idx" ON "customer_payment_allocations"("payment_id");
CREATE INDEX "customer_payment_allocations_sale_id_idx" ON "customer_payment_allocations"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payment_counters_tenant_id_branch_id_date_key_key" ON "customer_payment_counters"("tenant_id", "branch_id", "date_key");
CREATE INDEX "customer_payment_counters_tenant_id_idx" ON "customer_payment_counters"("tenant_id");
CREATE INDEX "customer_payment_counters_branch_id_idx" ON "customer_payment_counters"("branch_id");

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_counters" ADD CONSTRAINT "customer_payment_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payment_counters" ADD CONSTRAINT "customer_payment_counters_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "customer_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_allocations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "customer_payments"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "customer_payment_allocations"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "customer_payment_counters"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_payments TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_payment_allocations TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_payment_counters TO pos_app;
GRANT UPDATE (due_minor) ON TABLE public.sales TO pos_app;
