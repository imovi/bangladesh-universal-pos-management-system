# Multi-Tenant Module System & Platform Administration

## 1. Overview & Architecture

Universal POS serves multiple distinct retail verticals in Bangladesh—such as fashion boutiques, grocery stores, pharmacies, chemical distributors, and electronics retailers. Each vertical requires specific operational capabilities (e.g., expiry dates, chemical hazards, unit conversions, prescription handling).

To avoid bloated interfaces and maintain a clean core codebase, Phase 2.0 introduces a **two-level activation module system**:

```
                 +-------------------------------+
                 |        Platform Admin         |
                 |  (Controls Module Allowlist)  |
                 +---------------+---------------+
                                 |
                          allowed: boolean
                                 |
                                 v
                 +---------------+---------------+
                 |         Tenant Owner          |
                 |  (Toggles Feature Enablement) |
                 +---------------+---------------+
                                 |
                          enabled: boolean
                                 |
                                 v
                 +---------------+---------------+
                 |        Active Module          |
                 |  (allowed === true &&         |
                 |   enabled === true)           |
                 +-------------------------------+
```

A module is **active** for a tenant if and only if:
1. **Allowed** (`allowed === true`): Authorized by platform administration (e.g., plan tier, billing, or compliance approval).
2. **Enabled** (`enabled === true`): Activated by the tenant owner in store settings.

If a module is not allowed by the platform, the tenant owner cannot enable it, and the UI presents the toggle in a disabled state with the Bangla notification: *"প্ল্যাটফর্ম থেকে চালু করা হয়নি"* (Not enabled from platform).

---

## 2. Module Catalog, Dependencies & Business Defaults

Universal POS defines 8 core feature modules in `@universal-pos/shared`:

| Key | Bangla Name | English Name | Depends On | Default for Verticals |
| :--- | :--- | :--- | :--- | :--- |
| `units` | পরিমাপের একক ও রূপান্তর | Units & Conversion | None | `grocery`, `chemical`, `electronics` |
| `batch_expiry` | ব্যাচ ও মেয়াদ ট্র্যাকিং | Batch & Expiry | None | `grocery`, `pharmacy`, `chemical` |
| `chemical_safety` | রাসায়নিক নিরাপত্তা ও তথ্য | Chemical Safety | None | `chemical` |
| `b2b_wholesale` | পাইকারি ও করপোরেট বিক্রয় | B2B & Wholesale | None | `chemical`, `electronics` |
| `pharmacy_catalog` | ফার্মেসি ক্যাটালগ | Pharmacy Catalog | `units`, `batch_expiry` | `pharmacy` |
| `prescription` | প্রেসক্রিপশন ও ওষুধ বিতরণ | Prescription & Dispensing | `pharmacy_catalog` | `pharmacy` |
| `serial_tracking` | সিরিয়াল / IMEI ট্র্যাকিং | Serial / IMEI Tracking | None | `electronics` |
| `vat_mushak` | ভ্যাট ও মূসক চালান (NBR) | VAT & Mushak 6.3 | None | None (requires opt-in) |

### Dependency Resolution Rules
- **Enabling**: A module cannot be enabled unless all modules listed in its `dependsOn` array are already **active** (`allowed && enabled`). Attempting to enable returns HTTP `409 Conflict` with code `MODULE_DEPENDENCY_MISSING` and `missingModules: string[]`.
- **Disabling**: An active module cannot be disabled if another active module depends on it. Attempting to disable returns HTTP `409 Conflict` with code `MODULE_IN_USE_BY_DEPENDENT` and `dependentModules: string[]`.

### Business Type Defaults on Signup
When a new tenant signs up:
- Tenants of business type `chemical` automatically receive `units`, `batch_expiry`, `chemical_safety`, and `b2b_wholesale` with `allowed: true, enabled: true`.
- Tenants of business type `pharmacy` receive `units`, `batch_expiry`, `pharmacy_catalog`, and `prescription` with `allowed: true, enabled: true`.
- Tenants of business type `fashion` receive **0 module rows** by default, keeping apparel shops streamlined.

---

## 3. Database Schema & Row-Level Security (RLS)

### Feature Flags Table
Module state is persisted in the PostgreSQL `feature_flags` table:

```sql
CREATE TABLE public.feature_flags (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT false,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT feature_flags_tenant_id_key_key UNIQUE (tenant_id, key)
);
```

- Each module key is stored with prefix `module.<key>` (e.g., `module.units`).
- `feature_flags` is covered by PostgreSQL Row-Level Security (`tenant_isolation_policy`).
- Tenant application connections running as `pos_app` can only read and update feature flags belonging to their session's `app.tenant_id`.

---

## 4. Platform Administration & Role Narrowing

### Isolation of Platform Admin Access
To guarantee tenant isolation and defense-in-depth:
1. **Dedicated Database Table**: Platform administrators are stored in `public.platform_admins`.
2. **Database Role Revocation**: Table access is strictly granted to `pos_system` and `pos_admin`, and explicitly **revoked** from `pos_app`:
   ```sql
   REVOKE ALL ON TABLE public.platform_admins FROM pos_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO pos_system;
   ```
   Any tenant connection attempting to query `platform_admins` receives an immediate PostgreSQL `permission denied` error.
3. **Cryptographic Token Isolation**:
   - Platform tokens are signed with `PLATFORM_JWT_SECRET` (distinct from `JWT_ACCESS_SECRET`).
   - Platform tokens carry payload `{ scope: "platform", sub: adminId, email, name }` with a 30-minute lifetime.
   - Platform guards (`PlatformAuthGuard`) refuse any token lacking `scope: "platform"`.
   - Tenant guards (`JwtAuthGuard`) verify against `JWT_ACCESS_SECRET` and fail on platform tokens.
   - Platform tokens are stored strictly in browser `sessionStorage` (never in `localStorage`).

---

## 5. Developer Guide: Enforcing & Using Modules

### Protecting Backend Endpoints
To restrict an API endpoint to tenants with an active module, use the `@RequireModule` decorator alongside `ModuleGuard`:

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { ModuleGuard } from "@/common/guards/module.guard";
import { RequireModule } from "@/common/decorators/require-module.decorator";

@Controller("prescriptions")
@UseGuards(JwtAuthGuard, ModuleGuard)
export class PrescriptionsController {
  @Get()
  @RequireModule("prescription")
  async listPrescriptions() {
    // Only accessible if 'prescription' is allowed and enabled for current tenant
  }
}
```
If the module is inactive, `ModuleGuard` throws an HTTP `403 Forbidden` with body:
```json
{
  "code": "MODULE_DISABLED",
  "message": "এই ফিচারের জন্য প্রয়োজনীয় মডিউল সক্রিয় নেই।"
}
```

### Checking Module Status on Frontend
In any React component within `apps/admin`:

```tsx
import { useModules } from "@/lib/auth-context";

export function ProductDetails() {
  const { isModuleActive } = useModules();

  return (
    <div>
      <h3>পণ্য তথ্য</h3>
      {isModuleActive("units") && <UnitConversionSelector />}
      {isModuleActive("chemical_safety") && <ChemicalSafetyCard />}
    </div>
  );
}
```

### Filtering Navigation Items
In navigation menus or sidebars, declare `module?: ModuleKey` on `NavItem`:

```typescript
{
  titleKey: "prescriptions",
  href: "/prescriptions",
  permission: "prescription.read",
  module: "prescription",
}
```
The sidebar automatically filters out items when `!isModuleActive(item.module)`.

---

## 6. Audit Logging

Every module status modification is written to `audit_logs`:
- **Tenant Owner Changes**:
  - `action`: `module.update`
  - `entityId`: `<moduleKey>`
  - `actorUserId`: Tenant owner ID
  - `before`/`after`: `{ enabled: boolean }`
- **Platform Admin Changes**:
  - `action`: `platform.module.update`
  - `entityId`: `<moduleKey>`
  - `actorUserId`: `null` (actor is not a tenant user)
  - `after`: `{ allowed: boolean, platformActor: { id, email } }`
  - `notes`: `"Platform admin changed module allowlist"`
