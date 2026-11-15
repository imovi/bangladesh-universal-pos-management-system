-- CreateTable sales
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "shift_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "subtotal_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL,
    "change_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "void_reason" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable sale_items
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable sale_payments
CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_method" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable receipt_counters
CREATE TABLE "receipt_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "sales_tenant_id_invoice_number_key" ON "sales"("tenant_id", "invoice_number");
CREATE INDEX "sales_tenant_id_idx" ON "sales"("tenant_id");
CREATE INDEX "sales_shift_id_idx" ON "sales"("shift_id");
CREATE INDEX "sales_branch_id_idx" ON "sales"("branch_id");
CREATE INDEX "sales_cashier_user_id_idx" ON "sales"("cashier_user_id");
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
CREATE INDEX "sales_status_idx" ON "sales"("status");
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

CREATE INDEX "sale_items_tenant_id_idx" ON "sale_items"("tenant_id");
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX "sale_items_variant_id_idx" ON "sale_items"("variant_id");

CREATE INDEX "sale_payments_tenant_id_idx" ON "sale_payments"("tenant_id");
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");
CREATE INDEX "sale_payments_payment_method_idx" ON "sale_payments"("payment_method");

CREATE UNIQUE INDEX "receipt_counters_tenant_id_register_id_date_key_key" ON "receipt_counters"("tenant_id", "register_id", "date_key");
CREATE INDEX "receipt_counters_tenant_id_idx" ON "receipt_counters"("tenant_id");
CREATE INDEX "receipt_counters_register_id_idx" ON "receipt_counters"("register_id");

-- Foreign Keys
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS) Grants & Policies
GRANT SELECT, INSERT ON TABLE public.sales TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.sales FROM pos_app;
GRANT UPDATE (status, void_reason, voided_at, voided_by_user_id) ON TABLE public.sales TO pos_app;

GRANT SELECT, INSERT ON TABLE public.sale_items TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.sale_items FROM pos_app;

GRANT SELECT, INSERT ON TABLE public.sale_payments TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.sale_payments FROM pos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.receipt_counters TO pos_app;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sales',
    'sale_items',
    'sale_payments',
    'receipt_counters'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I ' ||
      'FOR ALL TO pos_app ' ||
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) ' ||
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid);',
      t
    );
  END LOOP;
END
$$;
