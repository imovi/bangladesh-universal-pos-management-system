-- AlterTable products
ALTER TABLE "products" ADD COLUMN "base_unit" TEXT NOT NULL DEFAULT 'pcs',
ADD COLUMN "allow_decimal_qty" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable product_units
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "factor" DECIMAL(14, 3) NOT NULL,
    "is_sale_unit" BOOLEAN NOT NULL DEFAULT true,
    "is_purchase_unit" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable variant_unit_prices
CREATE TABLE "variant_unit_prices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_unit_prices_pkey" PRIMARY KEY ("id")
);

-- Indexes for product_units
CREATE UNIQUE INDEX "product_units_product_id_name_key" ON "product_units"("product_id", "name");
CREATE INDEX "product_units_tenant_id_idx" ON "product_units"("tenant_id");
CREATE INDEX "product_units_product_id_idx" ON "product_units"("product_id");

-- Indexes for variant_unit_prices
CREATE UNIQUE INDEX "variant_unit_prices_variant_id_product_unit_id_key" ON "variant_unit_prices"("variant_id", "product_unit_id");
CREATE INDEX "variant_unit_prices_tenant_id_idx" ON "variant_unit_prices"("tenant_id");
CREATE INDEX "variant_unit_prices_variant_id_idx" ON "variant_unit_prices"("variant_id");
CREATE INDEX "variant_unit_prices_product_unit_id_idx" ON "variant_unit_prices"("product_unit_id");

-- Foreign keys for product_units
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys for variant_unit_prices
ALTER TABLE "variant_unit_prices" ADD CONSTRAINT "variant_unit_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_unit_prices" ADD CONSTRAINT "variant_unit_prices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_unit_prices" ADD CONSTRAINT "variant_unit_prices_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security and Grants for product_units
ALTER TABLE "product_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_units" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "product_units"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_units TO pos_app;

-- Row Level Security and Grants for variant_unit_prices
ALTER TABLE "variant_unit_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant_unit_prices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "variant_unit_prices"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.variant_unit_prices TO pos_app;

-- AlterTable variant_barcodes
ALTER TABLE "variant_barcodes" ADD COLUMN "product_unit_id" UUID;
CREATE INDEX "variant_barcodes_product_unit_id_idx" ON "variant_barcodes"("product_unit_id");
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable sale_items with backfill
ALTER TABLE "sale_items" ADD COLUMN "product_unit_id" UUID,
ADD COLUMN "unit_name" TEXT NOT NULL DEFAULT 'pcs',
ADD COLUMN "unit_factor" DECIMAL(14, 3) NOT NULL DEFAULT 1,
ADD COLUMN "base_quantity" DECIMAL(14, 3);

UPDATE "sale_items" SET "base_quantity" = "quantity", "unit_name" = 'pcs', "unit_factor" = 1 WHERE "base_quantity" IS NULL;

ALTER TABLE "sale_items" ALTER COLUMN "base_quantity" SET NOT NULL;
CREATE INDEX "sale_items_product_unit_id_idx" ON "sale_items"("product_unit_id");
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable purchase_order_items with backfill
ALTER TABLE "purchase_order_items" ADD COLUMN "product_unit_id" UUID,
ADD COLUMN "unit_name" TEXT NOT NULL DEFAULT 'pcs',
ADD COLUMN "unit_factor" DECIMAL(14, 3) NOT NULL DEFAULT 1,
ADD COLUMN "base_quantity" DECIMAL(14, 3);

UPDATE "purchase_order_items" SET "base_quantity" = "qty_ordered", "unit_name" = 'pcs', "unit_factor" = 1 WHERE "base_quantity" IS NULL;

ALTER TABLE "purchase_order_items" ALTER COLUMN "base_quantity" SET NOT NULL;
CREATE INDEX "purchase_order_items_product_unit_id_idx" ON "purchase_order_items"("product_unit_id");
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable goods_receipt_items with backfill
ALTER TABLE "goods_receipt_items" ADD COLUMN "product_unit_id" UUID,
ADD COLUMN "unit_name" TEXT NOT NULL DEFAULT 'pcs',
ADD COLUMN "unit_factor" DECIMAL(14, 3) NOT NULL DEFAULT 1,
ADD COLUMN "base_qty_received" DECIMAL(14, 3);

UPDATE "goods_receipt_items" SET "base_qty_received" = "qty_received", "unit_name" = 'pcs', "unit_factor" = 1 WHERE "base_qty_received" IS NULL;

ALTER TABLE "goods_receipt_items" ALTER COLUMN "base_qty_received" SET NOT NULL;
CREATE INDEX "goods_receipt_items_product_unit_id_idx" ON "goods_receipt_items"("product_unit_id");
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable sale_return_items with backfill
ALTER TABLE "sale_return_items" ADD COLUMN "base_quantity" DECIMAL(14, 3);

UPDATE "sale_return_items" sri
SET "base_quantity" = ROUND(sri."quantity" * COALESCE(si."unit_factor", 1), 3)
FROM "sale_items" si
WHERE sri."sale_item_id" = si."id" AND sri."base_quantity" IS NULL;

UPDATE "sale_return_items" SET "base_quantity" = "quantity" WHERE "base_quantity" IS NULL;

ALTER TABLE "sale_return_items" ALTER COLUMN "base_quantity" SET NOT NULL;
