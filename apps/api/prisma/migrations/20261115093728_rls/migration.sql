-- Create pos_app unprivileged application role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE pos_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Schema usage
GRANT USAGE ON SCHEMA public TO pos_app;

-- Explicit grants only on tenant tables (pos_app has NO access to 'tenants')
GRANT SELECT, INSERT, UPDATE, DELETE ON branches TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_branches TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO pos_app;

-- Audit logs: append-only (SELECT and INSERT only)
GRANT SELECT, INSERT ON audit_logs TO pos_app;
REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;

-- Ensure future tables are not silently accessible without explicit RLS
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM pos_app;

-- Enable and Force RLS on all 9 tenant tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'branches',
    'users',
    'roles',
    'role_permissions',
    'user_roles',
    'user_branches',
    'refresh_tokens',
    'feature_flags',
    'audit_logs'
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
