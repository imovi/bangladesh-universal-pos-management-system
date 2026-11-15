-- Migration: 20261116000000_fix6_tenants_rls_and_doc_counters
-- Fix 6: Enable & FORCE RLS on tenants, scoped pos_app grants/policy, pos_system policy,
-- drop unused pos_system update on tenants, and create document_counters with RLS for sequential numbering.

-- 1. Create document_counters table
CREATE TABLE IF NOT EXISTS public.document_counters (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_counters_tenant_id_doc_type_date_key_key" ON public.document_counters("tenant_id", "doc_type", "date_key");
CREATE INDEX IF NOT EXISTS "document_counters_tenant_id_idx" ON public.document_counters("tenant_id");
ALTER TABLE public.document_counters DROP CONSTRAINT IF EXISTS "document_counters_tenant_id_fkey";
ALTER TABLE public.document_counters ADD CONSTRAINT "document_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable & Force RLS on document_counters
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_counters FORCE ROW LEVEL SECURITY;

-- Grant document_counters access to pos_app
GRANT SELECT, INSERT, UPDATE ON TABLE public.document_counters TO pos_app;

DROP POLICY IF EXISTS pos_app_document_counters_policy ON public.document_counters;
CREATE POLICY pos_app_document_counters_policy ON public.document_counters
    TO pos_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- 2. Enable & Force RLS on tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

-- Grant column-level access to pos_app on tenants
GRANT SELECT (id, name, slug, settings, updated_at), UPDATE (name, settings, updated_at) ON TABLE public.tenants TO pos_app;

DROP POLICY IF EXISTS pos_app_tenants_policy ON public.tenants;
CREATE POLICY pos_app_tenants_policy ON public.tenants
    TO pos_app
    USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Policy for pos_system on tenants (needs select and insert for signup and lookup)
DROP POLICY IF EXISTS pos_system_tenants_policy ON public.tenants;
CREATE POLICY pos_system_tenants_policy ON public.tenants
    TO pos_system
    USING (true)
    WITH CHECK (true);

-- Revoke direct UPDATE on tenants from pos_system (now handled via tenant context by pos_app)
REVOKE UPDATE ON TABLE public.tenants FROM pos_system;
