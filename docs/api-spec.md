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
- `GET /api/v1/settings`: Retrieves tenant name and settings (timezone, currency, prices_include_tax, allow_negative_stock, receipt_header, receipt_footer). Accessible by Owner and Manager (`tenant.read`).
- `GET /api/v1/settings/pos`: Retrieves counter-safe shop settings for POS selling (`shopName`, `currency`, `timezone`, `pricesIncludeTax`, `allowNegativeStock`, `receiptHeader`, `receiptFooter`). Accessible by counter cashiers (`sale.create`).
- `PATCH /api/v1/settings`: Updates tenant name and settings. Requires Owner (`tenant.update`). Validated with strict schema (unknown keys rejected). `timezone` must be valid IANA identifier. Currency cannot be changed once tenant has any sale (returns HTTP 409 Conflict).

### 3.2 Branches, Users & Roles
- `GET /api/v1/branches`: List tenant branches.
- `POST /api/v1/branches`: Create new branch.
- `GET /api/v1/users`: List users in tenant with filters (`search`, `roleId`, `branchId`, `isActive`, `sortBy`, `sortOrder`, pagination).
- `POST /api/v1/users`: Create user and assign roles/branches.
- `GET /api/v1/roles`: List roles with permissions and `maxDiscountPercent`.
- `POST /api/v1/roles`: Create custom role with permissions and `maxDiscountPercent`.
- `PATCH /api/v1/roles/:id`: Update role permissions or max discount.

### 3.3 Catalog & Variants
- `GET|POST /api/v1/categories`: Hierarchical categories.
- `GET /api/v1/categories/:id`: Get category details with parent and children.
- `PATCH /api/v1/categories/:id`: Update category name, parentId, isActive. Rejects self-parent or descendant-as-parent with HTTP 422. Rejects duplicate name with HTTP 409.
- `GET|POST /api/v1/brands`: Brand master list.
- `GET /api/v1/brands/:id`: Get brand details.
- `PATCH /api/v1/brands/:id`: Update brand name and isActive. Rejects duplicate name with HTTP 409.
- `GET|POST /api/v1/collections`: Seasonal/style collections.
- `GET /api/v1/collections/:id`: Get collection details.
- `PATCH /api/v1/collections/:id`: Update collection name and isActive. Rejects duplicate name with HTTP 409.
- `GET|POST /api/v1/tax-classes`: Tax class master list.
- `GET /api/v1/tax-classes/:id`: Get tax class details.
- `PATCH /api/v1/tax-classes/:id`: Update tax class. Setting `isDefault: true` clears previous default in same transaction. Deactivating default tax class returns HTTP 409 Conflict.
- `POST /api/v1/products`: Create product with options (Size, Color), generates variant Cartesian product.
- `GET /api/v1/products`: List products with pagination, search (name, SKU, barcode), filters (`categoryId`, `brandId`, `collectionId`, `isActive` defaulting to `true`), and whitelist sort.
- `GET /api/v1/products/:id`: Get full product with variants and options.
- `GET /api/v1/variants/lookup`: Find variant by exact SKU or barcode.
- `GET /api/v1/variants/:id`: Get variant details (costs masked for Cashier role).
- `PATCH /api/v1/variants/:id`: Update variant priceMinor, costMinor, reorderLevel, isActive. Requires non-negative integers.
- `POST /api/v1/variants/:id/barcodes`: Add barcode to variant.
- `DELETE /api/v1/variants/:id/barcodes/:barcodeId`: Remove barcode. Returns HTTP 404 if barcode does not belong to that variant.
- `POST /api/v1/variants/bulk-price-update`: Batch update retail prices.

### 3.4 Inventory Ledger
- `POST /api/v1/inventory/movements`: Atomic stock adjustments (`damage`, `loss`, `internal_use`, etc.).
- `POST /api/v1/inventory/opening-stock`: Seed initial opening inventory levels.
- `GET /api/v1/inventory/levels`: Current on-hand stock levels by branch and variant, with pagination, search, low-stock filter, and whitelist sort.
- `GET /api/v1/inventory/low-stock`: Filter items where on-hand quantity is below reorder level.
- `GET /api/v1/inventory/movements`: Immutable historical stock ledger.

### 3.5 Purchasing & Suppliers
- `GET|POST /api/v1/suppliers`: Supplier directory with search, pagination, and whitelist sort.
- `GET /api/v1/suppliers/:id/balance`: Current supplier balance, total purchases received, and total payments made.
- `GET /api/v1/suppliers/:id/statement`: Chronological statement of receipts and payments with opening balance carry-forward across pagination and date ranges.
- `GET|POST /api/v1/purchase-orders`: Create and list purchase orders with filters and whitelist sort.
- `PATCH /api/v1/purchase-orders/:id/status`: Transition PO state (`draft` -> `ordered` -> `cancelled`).
- `GET /api/v1/goods-receipts`: List goods receipts filterable by `supplierId`, `purchaseOrderId`, `branchId`, date range, search, and whitelist sort.
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
  - Requires client-supplied `id` in the request body (UUID v7).
  - Requires mandatory `Idempotency-Key` header matching the body `id` (rejects missing or mismatched header with HTTP 400).
  - True idempotency: stores canonical SHA-256 payload hash in `request_payload_hash`.
    - Identical payload returns HTTP 200 with the existing sale.
    - Differing payload returns HTTP 409 Conflict (`"Sale <id> already exists with different payload"`).
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
