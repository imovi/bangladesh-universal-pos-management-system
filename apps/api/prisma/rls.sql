-- Setup unprivileged application role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app;
  END IF;
END
$$;

-- Schema usage grants
GRANT USAGE ON SCHEMA public TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;

-- Enforce append-only on audit_logs: revoke UPDATE and DELETE
REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;

-- Helper to apply RLS policy to a table
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
