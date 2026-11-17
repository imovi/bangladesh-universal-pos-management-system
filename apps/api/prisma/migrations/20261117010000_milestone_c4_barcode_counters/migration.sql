-- CreateTable
CREATE TABLE "barcode_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prefix" INTEGER NOT NULL DEFAULT 200,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barcode_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barcode_counters_tenant_id_key" ON "barcode_counters"("tenant_id");
CREATE INDEX "barcode_counters_tenant_id_idx" ON "barcode_counters"("tenant_id");

-- AddForeignKey
ALTER TABLE "barcode_counters" ADD CONSTRAINT "barcode_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "barcode_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "barcode_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON "barcode_counters"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.barcode_counters TO pos_app;
