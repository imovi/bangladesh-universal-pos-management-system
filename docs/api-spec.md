# Universal POS REST API Specification (Phase 1A: Single-Branch Fashion Outlet)

Base URL: `/api/v1`

---

## 1. Global Envelope Standard

All responses strictly follow the standardized envelope:

### Success (HTTP 200/201)
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": {
    "timestamp": "2026-11-15T15:00:00.000Z",
    "requestId": "0193309a-6b21-7000-8000-000000000001",
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}
```

### Error (HTTP 4xx/5xx)
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Input validation failed",
    "details": [{ "field": "slug", "issue": "Slug already registered" }]
  },
  "meta": {
    "timestamp": "2026-11-15T15:00:00.000Z",
    "requestId": "0193309a-6b21-7000-8000-000000000001"
  }
}
```

---

## 2. Invariants & Financial Conventions

- **Money representation**: Always minor units in integer poisha (`*_minor`, PostgreSQL `BIGINT`). No floats anywhere in money or tax math.
- **Tax Rates**: Represented in basis points (`100 bp = 1%`). Stored as `INTEGER`.
- **Quantities**: Exact 3-decimal fixed point `DECIMAL(14,3)` (e.g. `2.500`).
- **Identifiers**: UUID v7 across all entities. Sales, payments, and stock movements accept client-generated UUIDs for offline-first idempotency.
- **Immutability**: Completed sales, goods receipts, and stock movements cannot be modified or deleted. Reversals use compensating transactions (`sale_void`, `adjustment`).
- **Row Level Security (RLS)**: Enforced and forced across all tenant tables via `SET LOCAL ROLE pos_app; SET LOCAL app.tenant_id = '...'`.

---

## 3. Endpoints Directory

### 3.1 Authentication & Tenants
- `POST /api/v1/tenants/signup`: Provisions tenant, owner, default branch, system roles atomically.
- `POST /api/v1/auth/login`: Authenticates with `tenantSlug`, `email`, and `password`. Returns JWT tokens.
- `POST /api/v1/auth/refresh`: Exchanges refresh token for new access/refresh pair.
- `POST /api/v1/auth/logout`: Revokes refresh token.
- `GET /api/v1/auth/me`: Retrieves current authenticated session and permissions.

### 3.2 Branches, Users & Roles
- `GET /api/v1/branches`: List tenant branches.
- `POST /api/v1/branches`: Create new branch.
- `GET /api/v1/users`: List users in tenant.
- `POST /api/v1/users`: Create user and assign roles/branches.
- `GET /api/v1/roles`: List roles with permissions and `maxDiscountPercent`.
- `POST /api/v1/roles`: Create custom role with permissions and `maxDiscountPercent`.
- `PATCH /api/v1/roles/:id`: Update role permissions or max discount.

### 3.3 Catalog & Variants
- `GET|POST /api/v1/categories`: Hierarchical categories.
- `GET|POST /api/v1/brands`: Brand master list.
- `GET|POST /api/v1/collections`: Seasonal/style collections.
- `POST /api/v1/products`: Create product with options (Size, Color), generates variant Cartesian product.
- `GET /api/v1/products`: List products with pagination and filters.
- `GET /api/v1/products/:id`: Get full product with variants and options.
- `GET /api/v1/variants/lookup`: Find variant by exact SKU or barcode.
- `GET /api/v1/variants/:id`: Get variant details (costs masked for Cashier role).
- `POST /api/v1/variants/bulk-price-update`: Batch update retail prices.

### 3.4 Inventory Ledger
- `POST /api/v1/inventory/movements`: Atomic stock adjustments (`damage`, `loss`, `internal_use`, etc.).
- `POST /api/v1/inventory/opening-stock`: Seed initial opening inventory levels.
- `GET /api/v1/inventory/levels`: Current on-hand stock levels by branch and variant.
- `GET /api/v1/inventory/movements`: Immutable historical stock ledger.

### 3.5 Purchasing & Suppliers
- `GET|POST /api/v1/suppliers`: Supplier directory.
- `GET|POST /api/v1/purchase-orders`: Create and list purchase orders.
- `PATCH /api/v1/purchase-orders/:id/status`: Transition PO state (`draft` -> `ordered` -> `cancelled`).
- `POST /api/v1/goods-receipts`: Post goods receipt against PO or direct delivery. Automatically increments stock and updates weighted average cost.
- `POST /api/v1/supplier-payments`: Record payment to supplier against invoices.

### 3.6 Customers, Registers & Shifts
- `GET|POST /api/v1/customers`: Customer directory with phone normalization (`+8801...`).
- `GET|POST /api/v1/registers`: Counter registers per branch.
- `POST /api/v1/shifts/open`: Open cashier shift (enforces at most one open shift per register).
- `POST /api/v1/shifts/:id/cash-movements`: Record cash-in / cash-out with reason.
- `POST /api/v1/shifts/:id/close`: Reconcile and close shift with discrepancy calculation.
- `GET /api/v1/shifts/active`: Retrieve currently active shift for cashier/register.

### 3.7 Sales Engine
- `POST /api/v1/sales`:
  - Enforces open shift requirement.
  - Recomputes totals using pure math library; rejects discrepancies with HTTP 422.
  - Validates user discount limits:
    - Measures both individual line discounts and overall effective sale discount `(totalDiscountMinor / grossMinor)` in basis points (using integer ceiling math).
    - Prevents stacking line and bill discounts over user's role limit.
    - A price override is NOT a discount for this check (it is governed by `sale.price_override`), and the gross for discount calculation is based on the unit price actually charged.
    - Exceeding limit without `sale.discount_override` returns HTTP 403 with `{ code: "DISCOUNT_LIMIT_EXCEEDED" | "LINE_DISCOUNT_LIMIT_EXCEEDED", limitBp, attemptedBp }`.
  - Generates sequential gap-free invoice number `{REGISTER}-{YYMMDD}-{NNNN}` via PostgreSQL `FOR UPDATE`.
  - Atomically deducts inventory stock ledger (`type: 'sale'`).
  - Increments customer spent and visit counts.
  - Supports client-supplied `id` for idempotent duplicate prevention.
- `POST /api/v1/sales/:id/void`:
  - Requires `sale.void` permission.
  - Generates reversing stock movements (`type: 'sale_void'`).
  - Decrements customer total spent and visit counts.
  - Sets void status, reason, timestamp, and audit trail.
- `GET /api/v1/sales`: List sales with filters (branch, shift, date).
- `GET /api/v1/sales/:id`: Get sale details with line items and payments.

### 3.8 Fashion Analytics & Financial Reports
- `GET /api/v1/reports/sales-summary`: Aggregates gross, discounts, tax, net, and payment method breakdown (cash, card, bkash, nagad).
- `GET /api/v1/reports/sales-by-variant`: SKU, name, qty sold, revenue, average price.
- `GET /api/v1/reports/sales-by-category`: Revenue and item count grouped by category.
- `GET /api/v1/reports/sales-by-brand`: Revenue and item count grouped by brand.
- `GET /api/v1/reports/sales-by-collection`: Revenue and item count grouped by collection.
- `GET /api/v1/reports/variant-matrix`: Size × Color grid showing sales and current inventory.
- `GET /api/v1/reports/profit`:
  - Requires `report.profit` permission (Forbidden 403 for Cashier).
  - Calculates Revenue, COGS (unit cost snapshot), Gross Profit, and Margin (basis points).
- `GET /api/v1/reports/stock-valuation`: Total inventory valuation at weighted average cost.
- `GET /api/v1/reports/shift/:id`: Complete shift financial reconciliation.
