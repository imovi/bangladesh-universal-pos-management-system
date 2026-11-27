# Units & Unit Conversions Architecture (Phase 2.1)

This document describes the design, rules, and mathematical invariants governing units and unit conversions in the Universal POS system under the optional `units` module.

---

## 1. Core Principles & Rules

1. **Stock is Always in Base Unit:**
   - Physical stock levels (`stock_levels.qty`) and inventory audit trails (`stock_movements.qty_delta`) are strictly maintained in the product's defined base unit (e.g., `l`, `kg`, `meter`, `pcs`).
   - Transfers, stock adjustments, and opening stock are entered and tracked in the base unit in this phase.

2. **Sales & Purchasing Track Unit-of-Record:**
   - Every sale item, purchase order item, and goods receipt item stores the exact unit presented to the customer or supplier (`productUnitId`, `unitName`, `unitFactor`, `quantity`, `unitPriceMinor` / `unitCostMinor`).
   - Line financial math is exact per recorded unit (e.g., `2 drums × ৳8,500 = ৳17,000`). This completely eliminates fractional poisha rounding issues that would arise if storing derived per-liter rates.

3. **Snapshots & Base Quantity:**
   - Every transaction item permanently records a snapshot:
     - `unit_name`: Human-readable unit name at transaction time (e.g., `ড্রাম`, `৫ লিটার ক্যান`, `বস্তা`).
     - `unit_factor`: The conversion factor (number of base units per 1 unit) at transaction time.
     - `base_quantity`: The calculated base unit equivalent (`quantity × factor`), rounded to 3 decimal places.
   - All stock decrements/increments, inventory reports, and returns operate against `base_quantity`.

4. **Server-Side Trust Boundary:**
   - The server never trusts client-supplied unit prices or conversion factors.
   - For all operations, the server loads the active `ProductUnit` from the database, enforces validation (matching product, active sale/purchase status, decimal permissions), and evaluates prices either from explicit `VariantUnitPrice` overrides or proportional derivation (`v.priceMinor × factor`).

5. **Factor Lock Invariant (409 Conflict):**
   - Once a `ProductUnit` has been referenced in any completed sale item, purchase order item, or goods receipt item, its `factor` cannot be modified.
   - Any attempt to alter `factor` after transaction usage returns `409 Conflict` (`FACTOR_LOCKED`), instructing the merchant to deactivate the unit and create a new packing unit instead.
   - Historical returns and audits continue using the immutable snapshot `unit_factor` recorded on the original line.

6. **Base Unit Lock Invariant (409 Conflict):**
   - A product's `baseUnit` can only be altered while the product has zero stock movements and zero historical sales. Once inventory activity has occurred, `baseUnit` is locked.

---

## 2. Quantity & Rounding Math

### 2.1 Decimal Precision
- All physical quantities are represented with up to **3 decimal places** (`Decimal(14, 3)`), consistent with `parseQuantityThousandths` in `@universal-pos/shared`.
- When `allowDecimalQty = false`, both the entered `quantity` and calculated `baseQuantity` must be whole integers.

### 2.2 Base Quantity Calculation
Base quantity represents `quantity × factor`. It is calculated and rounded to 3 decimal places using **half-up rounding**:

$$\text{baseQuantity} = \frac{\text{round}(\text{quantity} \times \text{factor} \times 1000)}{1000}$$

Example:
- $2.5\text{ kg} \times 1\text{ (factor)} = 2.500\text{ kg}$
- $3\text{ cans} \times 5\text{ (factor)} = 15.000\text{ liters}$

### 2.3 Purchasing Unit Cost Rounding
When receiving goods in a packing unit (e.g., 2 drums at ৳8,000 each with factor 200), the underlying stock movement records the base unit cost in minor currency (poisha):

$$\text{unitCostMinor} = \text{round}\left(\frac{\text{lineCostMinor}}{\text{factor}}\right)$$

Example:
- Line cost per drum: ৳8,000 (800,000 poisha).
- Factor: 200 liters per drum.
- Base unit cost: $800,000 \div 200 = 4,000\text{ poisha (৳40.00/liter)}$.
- Fractional poisha amounts are rounded to the nearest integer poisha (half-up).

---

## 3. Pricing Architecture

### 3.1 Proportional Unit Price Derivation
When no price override is configured for a variant in a specific unit, the selling price is derived proportionally from the variant's base price:

$$\text{derivedPriceMinor} = \text{variantPriceMinor} \times \text{factor}$$

### 3.2 Variant Price Overrides (`VariantUnitPrice`)
Merchants may configure wholesale or bulk packaging pricing (e.g., 1 liter HCl is ৳45, but a 200L drum is ৳8,500 instead of $200 \times 45 = ৳9,000$).
- When a `VariantUnitPrice` record exists for `(variantId, productUnitId)`, the server uses `priceMinor` from this record directly.
- The POS catalog syncs all variant unit price overrides to client Dexie storage for instant offline price resolution.

---

## 4. Historical Data & Backfill Migration

The migration `20261127020000_phase2_1_units_and_conversions` applies backward-compatible columns to all transaction tables:
- `products.base_unit`: defaulted to `"pcs"`.
- `products.allow_decimal_qty`: defaulted to `false`.
- `sale_items`, `purchase_order_items`, `goods_receipt_items`:
  - `product_unit_id`: `NULL`
  - `unit_name`: Backfilled to `"pcs"`
  - `unit_factor`: Backfilled to `1.000`
  - `base_quantity`: Backfilled to `quantity`

### Historical Printing Continuity
- For fashion and retail tenants without the `units` module (or using base `"pcs"`), thermal and 80mm receipts remain **100% byte-for-byte identical**.
- Neither `"pcs"` nor `"পিস"` is ever printed on single-unit items, preserving existing receipt layouts verbatim.

---

## 5. Promotions & Loyalty Rules

1. **Whole-Unit Promotion Evaluation:**
   - Buy-X-Get-Y and quantity threshold promotions count whole transaction units:
     $$\text{wholeUnits} = \left\lfloor \frac{\text{quantityThousandths}}{1000} \right\rfloor$$
   - A promotion offering "Buy 2 cans HCl get 1 free" evaluates can lines directly. It will not trigger for a customer buying 10 individual liters in bulk.
2. **Decimal Quantities with Promotions:**
   - Decimal quantity lines (e.g., $2.5\text{ kg}$ caustic soda) cleanly apply percentage promotions without precision errors. The line discount is applied proportionally across the total line minor amount.

---

## 6. Offline Selling & Sync Protocol

1. **Sale Hash Uniqueness:**
   - The cryptographic sale hash incorporates `productUnitId` and `unitName`. Selling 1 drum of HCl vs 1 liter of HCl with identical line IDs produces distinct hashes, preventing accidental deduplication collision.
2. **Deactivated Unit Resilience:**
   - If a unit is deactivated on the server while a POS terminal is offline, synced sales using that unit are still accepted (protecting customer payments already collected).
   - The server creates a `SaleReviewFlag` (`UNIT_DEACTIVATED`) notifying the store manager of the post-sale discrepancy.
