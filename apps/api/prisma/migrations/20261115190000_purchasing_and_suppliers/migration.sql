-- CreateTable suppliers
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable purchase_orders
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_estimated_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "ordered_at" TIMESTAMP(3),
    "expected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable purchase_order_items
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty_ordered" DECIMAL(14,3) NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_cost_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable goods_receipts
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grn_number" TEXT NOT NULL,
    "purchase_order_id" UUID,
    "branch_id" UUID NOT NULL,
    "received_by_user_id" UUID,
    "notes" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable goods_receipt_items
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID,
    "variant_id" UUID NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable supplier_payments
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");
CREATE INDEX "suppliers_phone_idx" ON "suppliers"("phone");

CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_number_key" ON "purchase_orders"("tenant_id", "po_number");
CREATE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders"("tenant_id");
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE INDEX "purchase_orders_branch_id_idx" ON "purchase_orders"("branch_id");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

CREATE INDEX "purchase_order_items_tenant_id_idx" ON "purchase_order_items"("tenant_id");
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");
CREATE INDEX "purchase_order_items_variant_id_idx" ON "purchase_order_items"("variant_id");

CREATE UNIQUE INDEX "goods_receipts_tenant_id_grn_number_key" ON "goods_receipts"("tenant_id", "grn_number");
CREATE INDEX "goods_receipts_tenant_id_idx" ON "goods_receipts"("tenant_id");
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");
CREATE INDEX "goods_receipts_branch_id_idx" ON "goods_receipts"("branch_id");

CREATE INDEX "goods_receipt_items_tenant_id_idx" ON "goods_receipt_items"("tenant_id");
CREATE INDEX "goods_receipt_items_goods_receipt_id_idx" ON "goods_receipt_items"("goods_receipt_id");
CREATE INDEX "goods_receipt_items_purchase_order_item_id_idx" ON "goods_receipt_items"("purchase_order_item_id");
CREATE INDEX "goods_receipt_items_variant_id_idx" ON "goods_receipt_items"("variant_id");

CREATE INDEX "supplier_payments_tenant_id_idx" ON "supplier_payments"("tenant_id");
CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");
CREATE INDEX "supplier_payments_paid_at_idx" ON "supplier_payments"("paid_at");

-- Foreign Keys
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security (RLS) Grants & Policies
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_orders TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_order_items TO pos_app;

GRANT SELECT, INSERT ON TABLE public.goods_receipts TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.goods_receipts FROM pos_app;

GRANT SELECT, INSERT ON TABLE public.goods_receipt_items TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.goods_receipt_items FROM pos_app;

GRANT SELECT, INSERT ON TABLE public.supplier_payments TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.supplier_payments FROM pos_app;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'suppliers',
    'purchase_orders',
    'purchase_order_items',
    'goods_receipts',
    'goods_receipt_items',
    'supplier_payments'
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
