-- Create pos_system role (NOLOGIN, NOBYPASSRLS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_system') THEN
        CREATE ROLE pos_system NOLOGIN NOBYPASSRLS;
    END IF;
END
$$;

-- Grant group roles pos_app and pos_system to pos_runtime (if pos_runtime exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_runtime') THEN
        GRANT pos_app TO pos_runtime;
        GRANT pos_system TO pos_runtime;
        ALTER ROLE pos_runtime NOINHERIT;
    END IF;
END
$$;

-- Revoke direct table access from pos_runtime (runtime connects as pos_runtime and switches via SET LOCAL ROLE)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_runtime') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pos_runtime;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pos_runtime;
        GRANT USAGE ON SCHEMA public TO pos_runtime;
    END IF;
END
$$;

-- Explicit Grants for pos_system (only what SystemDbService needs)
GRANT USAGE ON SCHEMA public TO pos_system;
GRANT SELECT, INSERT ON TABLE public.tenants TO pos_system;
GRANT SELECT, INSERT ON TABLE public.branches TO pos_system;
GRANT SELECT, INSERT ON TABLE public.roles TO pos_system;
GRANT SELECT, INSERT ON TABLE public.role_permissions TO pos_system;
GRANT SELECT, INSERT ON TABLE public.users TO pos_system;
GRANT SELECT, INSERT ON TABLE public.user_roles TO pos_system;
GRANT SELECT, INSERT ON TABLE public.user_branches TO pos_system;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO pos_system;
GRANT SELECT, UPDATE ON TABLE public.refresh_tokens TO pos_system;

-- Revoke update and delete on audit_logs from pos_system (append-only)
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM pos_system;

-- RLS policies for pos_system on tenant tables with FORCE ROW LEVEL SECURITY
-- 1. branches (signup insert & returning)
CREATE POLICY system_signup_insert_branches ON public.branches
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_branches ON public.branches
    FOR SELECT TO pos_system USING (true);

-- 2. roles (signup insert & returning)
CREATE POLICY system_signup_insert_roles ON public.roles
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_roles ON public.roles
    FOR SELECT TO pos_system USING (true);

-- 3. role_permissions (signup insert & returning)
CREATE POLICY system_signup_insert_role_permissions ON public.role_permissions
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_role_permissions ON public.role_permissions
    FOR SELECT TO pos_system USING (true);

-- 4. users (signup insert & returning)
CREATE POLICY system_signup_insert_users ON public.users
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_users ON public.users
    FOR SELECT TO pos_system USING (true);

-- 5. user_roles (signup insert & returning)
CREATE POLICY system_signup_insert_user_roles ON public.user_roles
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_user_roles ON public.user_roles
    FOR SELECT TO pos_system USING (true);

-- 6. user_branches (signup insert & returning)
CREATE POLICY system_signup_insert_user_branches ON public.user_branches
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_user_branches ON public.user_branches
    FOR SELECT TO pos_system USING (true);

-- 7. audit_logs (signup insert & returning)
CREATE POLICY system_signup_insert_audit_logs ON public.audit_logs
    FOR INSERT TO pos_system WITH CHECK (true);

CREATE POLICY system_signup_select_audit_logs ON public.audit_logs
    FOR SELECT TO pos_system USING (true);

-- 8. refresh_tokens (lookup and revoke)
CREATE POLICY system_refresh_token_select ON public.refresh_tokens
    FOR SELECT TO pos_system USING (true);

CREATE POLICY system_refresh_token_update ON public.refresh_tokens
    FOR UPDATE TO pos_system USING (true) WITH CHECK (true);
