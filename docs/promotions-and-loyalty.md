# Promotions, Coupons and Loyalty Engine — Architecture & Design

This document details the architecture, calculation rules, mathematical foundations, stacking hierarchy, database schema, and offline behaviors for the Universal POS Promotions, Coupons, and Loyalty Points Engine in Phase 1E.

---

## 1. Unified Calculation Engine (`packages/shared/src/promotions.ts`)

### 1.1 Pure Function Guarantee
All promotion logic resides strictly in `packages/shared/src/promotions.ts` as a pure, deterministic function with **zero I/O**:
```ts
export function evaluatePromotions(input: PromotionEvaluationInput): PromotionEvaluationResult
```
Both the NestJS backend API (`POST /sales`, offline sync workers) and the Next.js frontend (`/pos` web application, offline Dexie worker) execute this exact function. No alternative discount calculation path is permitted.

### 1.2 Pipeline & Integration with `money.ts`
Discounts feed into `calculateSaleTotals` in `packages/shared/src/money.ts`:
1. **Gross Item Total**: `grossItemTotal = unitPriceMinor * quantity`
2. **Line Promotions**: Applied per qualifying unit. Line promotion discount is spread proportionally across the deal units.
3. **Bill Promotions / Coupon**: Applied to the post-line-promotion subtotal of eligible items.
4. **Manual Discounts**: Cashier's manual line/bill discounts apply to what remains. Manual line discount on a line that already has a promotion requires the permission `promotion.override`.
5. **VAT & Rounding**: Calculated on the net taxable amount after all discounts, using standard Bangladesh National Board of Revenue (NBR) rules without alteration.

---

## 2. Promotion Types & Stacking Rules

### 2.1 Promotion Types
| Type | Description & Rule |
| :--- | :--- |
| `PERCENT_OFF` | Percentage off each qualifying unit with an optional per-line cap (`maxDiscountMinor`). |
| `AMOUNT_OFF` | Flat amount off each qualifying unit. Discount never exceeds gross price (cannot go below 0). |
| `FIXED_PRICE` | Unit price overridden to a promotional price; applies only if lower than original unit price. |
| `BUY_X_GET_Y` | Buy $X$ qualifying units, get $Y$ units free or at a discount percent. The cheapest qualifying units in each group of $(X+Y)$ are designated as the "get" units. |
| `BUNDLE_PRICE` | Buy $N$ qualifying units for a fixed total amount $P$. The most expensive units are grouped first. |
| `BILL_THRESHOLD`| Spend $\ge T$ on eligible lines after line promotions, get $D\%$ off (with optional cap $C$) or flat $\text{৳}M$ off. |

### 2.2 Stacking Hierarchy (Best for Customer)
1. **Line Promotions**: At most **one promotion per unit**.
   - When multiple promotions could apply to a unit or cart lines, the engine selects the combination that maximizes the total discount for the customer.
   - Tie-breaking: Higher priority first; earlier `created_at` timestamp second.
   - Greedy algorithm with item ordering: units are grouped into eligible sets, and greedy partition delivers optimal savings with linear runtime $O(M \cdot N \log N)$ where $M$ is active promotions ($\le 20$) and $N$ is cart lines ($\le 50$). Runtime on 50 lines and 20 promotions is $\approx 1.2\text{ ms}$.
2. **Bill Promotion (Threshold or Coupon)**: At most **one bill promotion**, whichever yields the largest saving.
   - Evaluated against subtotal after line promotions.
   - If a line promotion is flagged `stackableWithBill = false`, those units are excluded from the bill promotion's calculation base.
3. **Cashier Manual Discounts**: Apply after promotions on the remaining net balance. Promotions **never** consume the cashier's `maxDiscountPercent` limit.

### 2.3 Proportional Spreading & Fair Return Math
Every deal discount (`BUY_X_GET_Y`, `BUNDLE_PRICE`, and `BILL_THRESHOLD`) is spread across its constituent units in proportion to their gross price using the largest-remainder method (Hamilton-Hare integer apportionment):
$$\text{discount}_i = \left\lfloor \frac{\text{price}_i}{\sum \text{price}} \times \text{totalDiscount} \right\rfloor + \text{remainderAdjustment}$$

#### Worked Examples:
1. **20% off**:
   - Panjabi $\text{৳}2,200 \times 2 = \text{৳}4,400$.
   - Discount: $20\% \times \text{৳}4,400 = \text{৳}880$.
   - Line total: $\text{৳}3,520$.
2. **Buy 2 Get 1 Free**:
   - Three Panjabis priced $\text{৳}3,000$, $\text{৳}2,500$, and $\text{৳}2,000$. Total gross: $\text{৳}7,500$.
   - The free unit is the cheapest: $\text{৳}2,000$. Deal discount = $\text{৳}2,000$.
   - Spread proportionally ($3000 : 2500 : 2000$):
     - $\text{৳}3,000$ unit discount: $\text{৳}800.00$ $\rightarrow$ net $\text{৳}2,200.00$.
     - $\text{৳}2,500$ unit discount: $\text{৳}666.67$ $\rightarrow$ net $\text{৳}1,833.33$.
     - $\text{৳}2,000$ unit discount: $\text{৳}533.33$ $\rightarrow$ net $\text{৳}1,466.67$.
   - Total net: $\text{৳}5,500.00$. Returning the $\text{৳}3,000$ Panjabi alone refunds its exact stored net: **$\text{৳}2,200.00$**.
3. **Bill Threshold**:
   - Rule: $10\%$ off on orders $\ge \text{৳}5,000$, maximum discount $\text{৳}1,000$.
   - Subtotal $\text{৳}4,999.99$: Discount is $\text{৳}0.00$.
   - Subtotal $\text{৳}12,000.00$: $10\% = \text{৳}1,200.00$, capped at **$\text{৳}1,000.00$**.

---

## 3. What Happens When a Return Breaks a Deal

### 3.1 Policy: Stored Line Value Refunds
When a customer returns items from a multi-item deal (e.g. returning 1 Panjabi from the Buy 2 Get 1 Free deal), the system refunds **exactly what the customer paid for that unit**, as recorded on the `sale_items.net_total_minor` line snapshot.
- The promotion is **never retroactively recalculated** on the remaining retained units.
- In the example above, the customer returns the $\text{৳}3,000$ Panjabi and receives $\text{৳}2,200.00$ back, keeping the other two at $\text{৳}1,833.33$ and $\text{৳}1,466.67$.
- *Decision Note for Operator:* This prevents cashier confusion, avoids asking the customer for additional money upon a return, and ensures thermal receipts reconcile identically to cash drawer movements. If the merchant later desires retroactive voiding of promotions upon partial returns, an explicit configuration toggle can be introduced.

---

## 4. Coupons & Concurrency

### 4.1 Specification
- Coupons are bill promotions requiring a unique code or bulk-generated single-use codes (e.g. for SMS marketing campaigns).
- Codes are case-insensitive and stored uppercase (`EID2026`, `SAVE500`).
- Validated against: start/end time, branch assignment, minimum spend threshold, total usage limits, and per-customer usage limits.

### 4.2 Concurrency & Limits
- Usage counters (`used_count`) are incremented inside the PostgreSQL database transaction when the sale record is inserted.
- Concurrency protection: `SELECT ... FOR UPDATE` on the coupon row prevents race conditions where two simultaneous checkouts exceed the remaining allocation. The second concurrent transaction receives `COUPON_LIMIT_REACHED`.
- Reversal: A full void or full return of a sale restores the coupon usage count (`used_count - 1`). Partial returns do not restore coupon usage.

---

## 5. Loyalty Points Engine

### 5.1 Append-Only Ledger (`loyalty_ledger`)
Points reside in an append-only ledger. Row modification and deletion are prohibited by database RLS and runtime guards.
- Fields: `id`, `tenantId`, `customerId`, `saleId`, `returnId`, `type`, `points` (signed integer), `expiresAt`, `createdAt`.
- Types: `EARN`, `REDEEM`, `REVERSE_EARN`, `REFUND_REDEEM`, `EXPIRE`, `ADJUST`.
- Customer's active balance is the sum of ledger entries ($\sum \text{points}$). A cached `loyalty_points_balance` column on `customers` is updated inside the same transaction and validated against the ledger sum in tests.

### 5.2 Mathematical Rules
- **Earning**:
  $$\text{pointsEarned} = \left\lfloor \frac{\text{Net Paid Minor} - \text{Points Redeemed Minor}}{100 \times \text{Earn Rate Divisor}} \right\rfloor$$
  Default: 1 point per $\text{৳}100$ of net cash/card/MFS paid.
- **Redeeming**:
  - Payment method `points` ("পয়েন্ট").
  - Value: 1 point = $\text{৳}1.00$.
  - Minimum points to redeem: default 100 points.
  - Maximum bill share: default $50\%$ of net bill.
  - Available online only (requires live balance check and atomic lock).
- **Returns & Reversals**:
  - Points earned on the original sale are reversed in exact proportion to the returned items.
  - If points were redeemed on the original sale, refunds are credited back as points first (`REFUND_REDEEM`), with any remainder refunded via the primary refund payment method.
  - If a points reversal causes the customer balance to drop below zero, the negative balance is permitted; the customer is blocked from redeeming further points until their balance becomes positive.
- **Expiry (FIFO)**:
  - Daily cron job runs at 03:00 Asia/Dhaka.
  - Finds active `EARN` points where `expiresAt <= NOW()` that have not been consumed by redemptions, and appends `EXPIRE` ledger entries.
  - Idempotent and safe to execute multiple times on the same day.

---

## 6. Offline Synchronization & Review Flags

1. **Catalog Caching**:
   - Active promotions and unlimited coupons are cached in IndexedDB (`db.promotions`).
   - Editing, creating, or pausing a promotion increments `catalogVersion`, alerting client terminals to fetch delta updates.
2. **Offline Limitations**:
   - Coupons with limited usage caps and loyalty point redemptions are disabled while offline, with explicit UI tooltips ("অনলাইনে ফিরলে করা যাবে").
3. **Conflict Resolution & Review Flags**:
   - The server **never rejects an offline sale** due to promotion discrepancies.
   - If a promotion was modified or paused while the terminal was offline, the server records the sale with the client's calculated totals and flags the sale in `/sales/offline-review`:
     - `PROMOTION_CHANGED`: Promotion altered between offline creation and sync.
     - `COUPON_LIMIT_EXCEEDED`: Promotion usage cap was reached online prior to offline sync.
   - Points earned on offline sales are recorded into `loyalty_ledger` during sync.

---

## 7. Role-Based Access Control & Permissions

| Permission | Default Roles | Scope |
| :--- | :--- | :--- |
| `promotion.view` | Owner, Manager | View promotion rules, analytics, and lists |
| `promotion.manage` | Owner, Manager | Create, edit, pause, end, and duplicate promotions |
| `promotion.override`| Owner, Manager | Apply manual discounts on lines with active promotions |
| `loyalty.manage` | Owner | Configure loyalty program rules and point values |
| `loyalty.adjust` | Owner, Manager | Manually adjust customer points (with audit log entry) |

---

## 8. Decisions the Operator May Want to Change
1. **Returns that Break a Deal**: Returns refund the stored line net amount rather than recalculating the promotion retroactively.
2. **Credit ("Baki") Sales Earning Points**: Credit sales earn loyalty points immediately upon invoice creation. If the operator prefers points to mature only upon receipt of due payments, an earn trigger toggle can be provided.
3. **Negative Points Balance**: When a return occurs after earned points have already been redeemed elsewhere, the customer's balance can become negative.
4. **Default Earn and Redemption Values**: Default earn rate is 1 point per $\text{৳}100$ and redemption value is $\text{৳}1.00$ per point; configurable in `/settings/loyalty`.
