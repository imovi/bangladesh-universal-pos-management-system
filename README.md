# Bangladesh Universal POS Management System

Universal, multi-tenant, offline-first Point-of-Sale (POS) and inventory platform engineered for Bangladeshi businesses (Fashion, Retail, Chemical, E-commerce, Pharmacy, and Electronics).

## Architecture Highlights

- **Single Core Engine, Multi-Tenant Modular Architecture**: Shared PostgreSQL database with Row Level Security (RLS) enforcement per tenant.
- **Offline-First Resilience**: Local client storage with UUID v7 and idempotency-guaranteed outbox synchronization.
- **Strict Accounting & Money Handling**: Represented in integer minor units (Poisha / Cents) to completely avoid floating-point inaccuracies.
- **Auditability**: Tamper-proof, append-only audit trail and append-only stock movement ledger.
- **Local Context**: First-class support for bKash, Nagad, Bangla invoice layouts, NBR VAT compliance, and local delivery couriers.

## Monorepo Layout

```
├── apps/
│   ├── api/                 # NestJS 12 backend REST API & Prisma RLS
│   ├── admin/               # (Phase 1) React / Next.js Admin Portal
│   └── pos/                 # (Phase 1) Offline-first PWA / Tauri Counter App
├── packages/
│   └── shared/              # Shared Zod schemas, permissions, DTOs & types
├── docs/                    # Architecture diagrams and API contract specs
├── docker-compose.yml       # PostgreSQL 17 & Redis 7 services
└── .github/workflows/ci.yml # Automated linting, RLS isolation & coverage testing
```

## Quick Start

1. **Clone repository:**

   ```bash
   git clone https://github.com/imovi/bangladesh-universal-pos-management-system.git
   cd bangladesh-universal-pos-management-system
   ```

2. **Start Services:**

   ```bash
   docker compose up -d
   ```

3. **Install Dependencies & Build:**

   ```bash
   npm install
   npm run build
   ```

4. **Run Migrations & Tests:**
   ```bash
   npm test
   ```

## Database Roles Architecture & Security
The database uses a three-tier role security model:
1. **Migration / Owner User (`pos_admin`)**: Used strictly by Prisma CLI for executing migrations (`MIGRATION_DATABASE_URL` / `directUrl`). Table owner with full schema rights. Never used at runtime.
2. **Runtime Login User (`pos_runtime`)**: Non-superuser with `NOINHERIT` and zero direct table privileges. Used by the application at runtime (`DATABASE_URL`) and in tests (`TEST_DATABASE_URL`). Member of `pos_app` and `pos_system`.
3. **NOLOGIN Group Roles**:
   - `pos_app`: Used for tenant-scoped operations (`runWithTenant`). Protected by `FORCE ROW LEVEL SECURITY` and `tenant_isolation_policy`.
   - `pos_system`: Used for system operations in `SystemDbService` (`SET LOCAL ROLE pos_system`). Holds minimal grants for tenant lookup, atomic signup inserts, and refresh tokens.

### Bootstrap Script
Login users and passwords are created outside migration files using environment variables:
- In Docker: `docker/init-db.sh` runs automatically on container initialization.
- In CI / Shell: `scripts/bootstrap-db.sh` can be executed to create `pos_runtime` and `universal_pos_test`.

### Test Database Isolation
Tests run against a dedicated test database (`universal_pos_test`). The test suite (`test-db-helper.ts`) strictly refuses to run destructive operations (such as truncate) unless the database name ends in `_test`, completely protecting the development database.

## Database Migration & Tenant Isolation (RLS) Rule
> **IMPORTANT FOR NEW TABLES**: Every new table created with `tenant_id` MUST have `ENABLE` and `FORCE ROW LEVEL SECURITY` turned on, grants given to `pos_app`, and the tenant isolation policy defined in its own migration:
> ```sql
> GRANT SELECT, INSERT, UPDATE, DELETE ON <new_table> TO pos_app;
> ALTER TABLE <new_table> ENABLE ROW LEVEL SECURITY;
> ALTER TABLE <new_table> FORCE ROW LEVEL SECURITY;
> CREATE POLICY tenant_isolation_policy ON <new_table>
>   FOR ALL TO pos_app
>   USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
>   WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
> ```

