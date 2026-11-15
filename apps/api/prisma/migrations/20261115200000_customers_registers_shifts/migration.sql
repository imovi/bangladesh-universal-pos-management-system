-- CreateTable customers
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "total_spent_minor" BIGINT NOT NULL DEFAULT 0,
    "total_visits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable registers
CREATE TABLE "registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable shifts
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opening_cash_minor" BIGINT NOT NULL,
    "closing_cash_minor" BIGINT,
    "expected_cash_minor" BIGINT,
    "cash_difference_minor" BIGINT,
    "notes" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable cash_movements
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "customers_name_idx" ON "customers"("name");
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

CREATE UNIQUE INDEX "registers_tenant_id_branch_id_code_key" ON "registers"("tenant_id", "branch_id", "code");
CREATE INDEX "registers_tenant_id_idx" ON "registers"("tenant_id");
CREATE INDEX "registers_branch_id_idx" ON "registers"("branch_id");

CREATE INDEX "shifts_tenant_id_idx" ON "shifts"("tenant_id");
CREATE INDEX "shifts_register_id_idx" ON "shifts"("register_id");
CREATE INDEX "shifts_branch_id_idx" ON "shifts"("branch_id");
CREATE INDEX "shifts_cashier_user_id_idx" ON "shifts"("cashier_user_id");
CREATE INDEX "shifts_status_idx" ON "shifts"("status");

-- Partial Unique Index: at most ONE open shift per register
CREATE UNIQUE INDEX "shifts_open_register_idx" ON "shifts"("tenant_id", "register_id") WHERE ("status" = 'open');

CREATE INDEX "cash_movements_tenant_id_idx" ON "cash_movements"("tenant_id");
CREATE INDEX "cash_movements_shift_id_idx" ON "cash_movements"("shift_id");
CREATE INDEX "cash_movements_type_idx" ON "cash_movements"("type");

-- Foreign Keys
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registers" ADD CONSTRAINT "registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "registers" ADD CONSTRAINT "registers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS) Grants & Policies
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.registers TO pos_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.shifts TO pos_app;

GRANT SELECT, INSERT ON TABLE public.cash_movements TO pos_app;
REVOKE UPDATE, DELETE ON TABLE public.cash_movements FROM pos_app;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'customers',
    'registers',
    'shifts',
    'cash_movements'
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
