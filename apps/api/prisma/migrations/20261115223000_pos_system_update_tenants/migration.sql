-- Grant UPDATE on tenants to pos_system so SystemDbService.updateTenantSettings succeeds
GRANT UPDATE ON TABLE public.tenants TO pos_system;
