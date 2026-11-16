-- AlterTable
ALTER TABLE "categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "categories_tenant_id_name_idx" ON "categories"("tenant_id", "name");

-- AlterTable
ALTER TABLE "brands" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "brands_tenant_id_name_idx" ON "brands"("tenant_id", "name");

-- AlterTable
ALTER TABLE "collections" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "collections_tenant_id_name_idx" ON "collections"("tenant_id", "name");

-- AlterTable
ALTER TABLE "tax_classes" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "tax_classes_tenant_id_name_idx" ON "tax_classes"("tenant_id", "name");

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN "supplier_id" UUID;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "goods_receipts_supplier_id_idx" ON "goods_receipts"("supplier_id");

-- Grant additional tenant fields for settings read
GRANT SELECT (business_type, created_at) ON TABLE public.tenants TO pos_app;
