-- AlterTable registers
ALTER TABLE "registers" ADD COLUMN "allow_offline" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable sales
ALTER TABLE "sales" ADD COLUMN "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sales" ADD COLUMN "synced_at" TIMESTAMP(3);
ALTER TABLE "sales" ADD COLUMN "is_offline" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales" ADD COLUMN "catalog_version" TEXT;

-- CreateIndex on sales(occurred_at)
CREATE INDEX "sales_occurred_at_idx" ON "sales"("occurred_at");

-- CreateTable sale_review_flags
CREATE TABLE "sale_review_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "flag" TEXT NOT NULL,
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" UUID,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_review_flags_tenant_id_idx" ON "sale_review_flags"("tenant_id");
CREATE INDEX "sale_review_flags_sale_id_idx" ON "sale_review_flags"("sale_id");
CREATE INDEX "sale_review_flags_status_idx" ON "sale_review_flags"("status");

-- AddForeignKey
ALTER TABLE "sale_review_flags" ADD CONSTRAINT "sale_review_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_review_flags" ADD CONSTRAINT "sale_review_flags_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_review_flags" ADD CONSTRAINT "sale_review_flags_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "sale_review_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_review_flags" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "sale_review_flags"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sale_review_flags TO pos_app;
