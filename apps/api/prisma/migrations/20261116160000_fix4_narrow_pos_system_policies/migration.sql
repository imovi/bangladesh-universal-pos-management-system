-- Fix 4: Remove broad read policies and revoke SELECT for pos_system role
-- Tables affected: branches, roles, role_permissions, users, user_roles, user_branches, audit_logs

-- 1. Drop broad SELECT policies granted to pos_system
DROP POLICY IF EXISTS system_signup_select_branches ON public.branches;
DROP POLICY IF EXISTS system_signup_select_roles ON public.roles;
DROP POLICY IF EXISTS system_signup_select_role_permissions ON public.role_permissions;
DROP POLICY IF EXISTS system_signup_select_users ON public.users;
DROP POLICY IF EXISTS system_signup_select_user_roles ON public.user_roles;
DROP POLICY IF EXISTS system_signup_select_user_branches ON public.user_branches;
DROP POLICY IF EXISTS system_signup_select_audit_logs ON public.audit_logs;

-- 2. Revoke SELECT privileges from pos_system on these tables
REVOKE SELECT ON TABLE public.branches FROM pos_system;
REVOKE SELECT ON TABLE public.roles FROM pos_system;
REVOKE SELECT ON TABLE public.role_permissions FROM pos_system;
REVOKE SELECT ON TABLE public.users FROM pos_system;
REVOKE SELECT ON TABLE public.user_roles FROM pos_system;
REVOKE SELECT ON TABLE public.user_branches FROM pos_system;
REVOKE SELECT ON TABLE public.audit_logs FROM pos_system;
