-- AlterTable
ALTER TABLE "customers" ADD COLUMN "birth_date" TIMESTAMP(3),
ADD COLUMN "loyalty_points_balance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN "promotion_discount_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "promotion_id" UUID,
ADD COLUMN "promotion_label" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "bill_promotion_discount_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "bill_promotion_id" UUID,
ADD COLUMN "coupon_code" TEXT,
ADD COLUMN "points_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed_minor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "stackable_with_bill" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "targets" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "total_uses" INTEGER NOT NULL DEFAULT 0,
    "total_discount_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "promotion_id" UUID,
    "code" TEXT NOT NULL,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "customer_id" UUID,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "earn_rate_minor" BIGINT NOT NULL DEFAULT 10000,
    "point_value_minor" BIGINT NOT NULL DEFAULT 100,
    "min_redeem_points" INTEGER NOT NULL DEFAULT 100,
    "max_bill_share_percent" INTEGER NOT NULL DEFAULT 50,
    "expiry_months" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sale_id" UUID,
    "return_id" UUID,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_tenant_id_idx" ON "promotions"("tenant_id");
CREATE INDEX "promotions_tenant_id_status_idx" ON "promotions"("tenant_id", "status");
CREATE INDEX "promotions_tenant_id_type_idx" ON "promotions"("tenant_id", "type");
CREATE INDEX "promotions_start_date_end_date_idx" ON "promotions"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "coupons_tenant_id_idx" ON "coupons"("tenant_id");
CREATE INDEX "coupons_promotion_id_idx" ON "coupons"("promotion_id");
CREATE INDEX "coupons_code_idx" ON "coupons"("code");
CREATE UNIQUE INDEX "coupons_tenant_id_code_key" ON "coupons"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "coupon_usages_tenant_id_idx" ON "coupon_usages"("tenant_id");
CREATE INDEX "coupon_usages_coupon_id_idx" ON "coupon_usages"("coupon_id");
CREATE INDEX "coupon_usages_sale_id_idx" ON "coupon_usages"("sale_id");
CREATE INDEX "coupon_usages_customer_id_idx" ON "coupon_usages"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_settings_tenant_id_key" ON "loyalty_settings"("tenant_id");
CREATE INDEX "loyalty_settings_tenant_id_idx" ON "loyalty_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "loyalty_ledger_tenant_id_idx" ON "loyalty_ledger"("tenant_id");
CREATE INDEX "loyalty_ledger_customer_id_idx" ON "loyalty_ledger"("customer_id");
CREATE INDEX "loyalty_ledger_sale_id_idx" ON "loyalty_ledger"("sale_id");
CREATE INDEX "loyalty_ledger_return_id_idx" ON "loyalty_ledger"("return_id");
CREATE INDEX "loyalty_ledger_type_idx" ON "loyalty_ledger"("type");
CREATE INDEX "loyalty_ledger_created_at_idx" ON "loyalty_ledger"("created_at");
CREATE INDEX "loyalty_ledger_expires_at_idx" ON "loyalty_ledger"("expires_at");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_bill_promotion_id_fkey" FOREIGN KEY ("bill_promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_settings" ADD CONSTRAINT "loyalty_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupons" FORCE ROW LEVEL SECURITY;

ALTER TABLE "coupon_usages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupon_usages" FORCE ROW LEVEL SECURITY;

ALTER TABLE "loyalty_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_settings" FORCE ROW LEVEL SECURITY;

ALTER TABLE "loyalty_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_ledger" FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
CREATE POLICY "tenant_isolation_policy" ON "promotions"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "coupons"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "coupon_usages"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "loyalty_settings"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_policy" ON "loyalty_ledger"
    AS PERMISSIVE FOR ALL
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotions TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coupons TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coupon_usages TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loyalty_settings TO pos_app;

-- Append-only for loyalty_ledger: only SELECT and INSERT (NO UPDATE, NO DELETE)
GRANT SELECT, INSERT ON TABLE public.loyalty_ledger TO pos_app;
