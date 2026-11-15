/**
 * Pure money and tax calculations for Universal POS.
 * Formulated with integer minor units (poisha) and 3-decimal quantities.
 * Designed to execute identically on the NestJS backend and offline POS counter app.
 */

export interface DiscountSpec {
  type: "fixed" | "percent";
  amountMinor?: bigint | number;
  percentBp?: number; // Basis points: 10000 = 100.00%, 750 = 7.50%
}

export interface SaleLineItemInput {
  lineId?: string;
  variantId: string;
  unitPriceMinor: bigint | number;
  quantity: number | string;
  discount?: DiscountSpec;
  taxRateBp: number; // Basis points: 750 = 7.5%
}

export interface SaleCalculationOptions {
  pricesIncludeTax: boolean;
  billDiscount?: DiscountSpec;
}

export interface CalculatedSaleLine {
  lineId?: string;
  variantId: string;
  unitPriceMinor: bigint;
  quantityThousandths: bigint;
  quantity: string;
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  lineNetMinor: bigint;
  allocatedBillDiscountMinor: bigint;
  effectiveLineNetMinor: bigint;
  taxRateBp: number;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface TaxBreakdownItem {
  taxRateBp: number;
  taxableAmountMinor: bigint;
  taxAmountMinor: bigint;
}

export interface CalculatedSaleTotals {
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  billDiscountMinor: bigint;
  totalDiscountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lines: CalculatedSaleLine[];
  taxBreakdown: TaxBreakdownItem[];
}

/**
 * Rounds numerator / denominator half up to the nearest integer.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n || numerator === 0n) return 0n;

  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const rounded = (absNum + absDen / 2n) / absDen;
  return isNegative ? -rounded : rounded;
}

/**
 * Parses numeric or decimal string quantity into integer thousandths (DECIMAL(14,3)).
 */
export function parseQuantityThousandths(qty: number | string): bigint {
  if (typeof qty === "number") {
    // Convert to string with 3 decimal places to avoid IEEE 754 drift
    return parseQuantityThousandths(qty.toFixed(3));
  }

  const trimmed = qty.trim();
  const match = trimmed.match(/^(-?\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid quantity string: "${qty}"`);
  }

  const isNegative = match[1].startsWith("-");
  const wholePart = BigInt(match[1]);
  const fractionStr = (match[2] || "").slice(0, 3).padEnd(3, "0");
  const fractionPart = BigInt(fractionStr);

  const absWhole = wholePart < 0n ? -wholePart : wholePart;
  const thousandths = absWhole * 1000n + fractionPart;

  return isNegative ? -thousandths : thousandths;
}

/**
 * Formats thousandths back to normalized 3-decimal string (e.g. 1500n -> "1.500").
 */
export function formatQuantityFromThousandths(thousandths: bigint): string {
  const isNeg = thousandths < 0n;
  const absVal = isNeg ? -thousandths : thousandths;
  const whole = absVal / 1000n;
  const frac = (absVal % 1000n).toString().padStart(3, "0");
  return `${isNeg ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Evaluates line discount in minor units.
 */
function calculateLineDiscount(
  grossMinor: bigint,
  discount?: DiscountSpec,
): bigint {
  if (!discount) return 0n;

  if (discount.type === "fixed") {
    const amt = BigInt(discount.amountMinor ?? 0);
    return amt > grossMinor ? grossMinor : amt < 0n ? 0n : amt;
  }

  if (discount.type === "percent") {
    const bp = BigInt(discount.percentBp ?? 0);
    if (bp <= 0n) return 0n;
    const discountAmount = roundHalfUp(grossMinor * bp, 10000n);
    return discountAmount > grossMinor ? grossMinor : discountAmount;
  }

  return 0n;
}

/**
 * Distributes bill-level discount across lines proportionally using the Largest Remainder Method.
 */
export function distributeBillDiscount(
  lines: Array<{ lineNetMinor: bigint }>,
  totalBillDiscountMinor: bigint,
): bigint[] {
  if (lines.length === 0 || totalBillDiscountMinor <= 0n) {
    return lines.map(() => 0n);
  }

  const totalLineNet = lines.reduce((acc, l) => acc + l.lineNetMinor, 0n);
  if (totalLineNet <= 0n) {
    return lines.map(() => 0n);
  }

  const effectiveDiscount =
    totalBillDiscountMinor > totalLineNet
      ? totalLineNet
      : totalBillDiscountMinor;

  const shares = lines.map((l, index) => {
    const product = l.lineNetMinor * effectiveDiscount;
    const base = product / totalLineNet;
    const remainder = product % totalLineNet;
    return { index, base, remainder };
  });

  const sumBase = shares.reduce((acc, s) => acc + s.base, 0n);
  let discrepancy = Number(effectiveDiscount - sumBase);

  // Sort by remainder descending, then original index ascending
  const sortedShares = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.index - b.index;
  });

  const allocated = new Array<bigint>(lines.length).fill(0n);
  for (const s of sortedShares) {
    let extra = 0n;
    if (discrepancy > 0) {
      extra = 1n;
      discrepancy -= 1;
    }
    allocated[s.index] = s.base + extra;
  }

  return allocated;
}

/**
 * Computes line tax given effective net and tax mode.
 */
function calculateLineTax(
  effectiveNetMinor: bigint,
  taxRateBp: number,
  pricesIncludeTax: boolean,
): bigint {
  if (taxRateBp <= 0 || effectiveNetMinor <= 0n) {
    return 0n;
  }

  const rate = BigInt(taxRateBp);
  if (pricesIncludeTax) {
    // Tax extracted from inclusive price: Price * Rate / (10000 + Rate)
    return roundHalfUp(effectiveNetMinor * rate, 10000n + rate);
  } else {
    // Tax added on top: Price * Rate / 10000
    return roundHalfUp(effectiveNetMinor * rate, 10000n);
  }
}

/**
 * Complete sale calculation engine for bill and line items.
 */
export function calculateSaleTotals(
  items: SaleLineItemInput[],
  options: SaleCalculationOptions,
): CalculatedSaleTotals {
  // Phase 1: Compute gross and line discounts
  const rawLines = items.map((item) => {
    const unitPrice = BigInt(item.unitPriceMinor);
    const qtyThousandths = parseQuantityThousandths(item.quantity);
    const gross = roundHalfUp(unitPrice * qtyThousandths, 1000n);
    const lineDiscount = calculateLineDiscount(gross, item.discount);
    const lineNet = gross - lineDiscount;

    return {
      lineId: item.lineId,
      variantId: item.variantId,
      unitPriceMinor: unitPrice,
      quantityThousandths: qtyThousandths,
      quantity: formatQuantityFromThousandths(qtyThousandths),
      grossMinor: gross,
      lineDiscountMinor: lineDiscount,
      lineNetMinor: lineNet,
      taxRateBp: item.taxRateBp,
    };
  });

  // Phase 2: Distribute bill discount
  const subtotalNet = rawLines.reduce((acc, l) => acc + l.lineNetMinor, 0n);
  let totalBillDiscount = 0n;

  if (options.billDiscount) {
    if (options.billDiscount.type === "fixed") {
      totalBillDiscount = BigInt(options.billDiscount.amountMinor ?? 0);
    } else if (options.billDiscount.type === "percent") {
      const bp = BigInt(options.billDiscount.percentBp ?? 0);
      totalBillDiscount = roundHalfUp(subtotalNet * bp, 10000n);
    }
  }

  const allocatedDiscounts = distributeBillDiscount(
    rawLines,
    totalBillDiscount,
  );

  // Phase 3: Compute taxes and line totals
  const lines: CalculatedSaleLine[] = rawLines.map((line, idx) => {
    const allocatedBillDiscount = allocatedDiscounts[idx];
    const effectiveNet = line.lineNetMinor - allocatedBillDiscount;
    const tax = calculateLineTax(
      effectiveNet,
      line.taxRateBp,
      options.pricesIncludeTax,
    );

    const total = options.pricesIncludeTax
      ? effectiveNet
      : effectiveNet + tax;

    return {
      ...line,
      allocatedBillDiscountMinor: allocatedBillDiscount,
      effectiveLineNetMinor: effectiveNet,
      taxMinor: tax,
      totalMinor: total,
    };
  });

  // Aggregate totals
  const grossMinor = lines.reduce((acc, l) => acc + l.grossMinor, 0n);
  const lineDiscountMinor = lines.reduce(
    (acc, l) => acc + l.lineDiscountMinor,
    0n,
  );
  const billDiscountMinor = lines.reduce(
    (acc, l) => acc + l.allocatedBillDiscountMinor,
    0n,
  );
  const totalDiscountMinor = lineDiscountMinor + billDiscountMinor;
  const netMinor = lines.reduce(
    (acc, l) => acc + l.effectiveLineNetMinor,
    0n,
  );
  const taxMinor = lines.reduce((acc, l) => acc + l.taxMinor, 0n);
  const totalMinor = lines.reduce((acc, l) => acc + l.totalMinor, 0n);

  // Group tax breakdown by rate
  const taxMap = new Map<number, { taxable: bigint; tax: bigint }>();
  for (const l of lines) {
    if (l.taxRateBp > 0) {
      const cur = taxMap.get(l.taxRateBp) || { taxable: 0n, tax: 0n };
      const taxable = options.pricesIncludeTax
        ? l.effectiveLineNetMinor - l.taxMinor
        : l.effectiveLineNetMinor;

      taxMap.set(l.taxRateBp, {
        taxable: cur.taxable + taxable,
        tax: cur.tax + l.taxMinor,
      });
    }
  }

  const taxBreakdown: TaxBreakdownItem[] = Array.from(taxMap.entries()).map(
    ([rate, data]) => ({
      taxRateBp: rate,
      taxableAmountMinor: data.taxable,
      taxAmountMinor: data.tax,
    }),
  );

  return {
    grossMinor,
    lineDiscountMinor,
    billDiscountMinor,
    totalDiscountMinor,
    netMinor,
    taxMinor,
    totalMinor,
    lines,
    taxBreakdown,
  };
}

/**
 * Calculates new weighted average cost upon receiving goods.
 * Formula:
 *   new_avg = roundHalfUp((old_qty * old_cost + recv_qty * recv_cost) / (old_qty + recv_qty))
 * If old_qty <= 0, returns recv_cost.
 */
export function calculateWeightedAverageCost(
  oldQty: number | string,
  oldCostMinor: bigint | number,
  recvQty: number | string,
  recvCostMinor: bigint | number,
): bigint {
  const oldQtyThousandths = parseQuantityThousandths(oldQty);
  const recvQtyThousandths = parseQuantityThousandths(recvQty);
  const oldCost = BigInt(oldCostMinor);
  const recvCost = BigInt(recvCostMinor);

  if (oldQtyThousandths <= 0n) {
    return recvCost;
  }

  const totalQtyThousandths = oldQtyThousandths + recvQtyThousandths;
  if (totalQtyThousandths <= 0n) {
    return recvCost;
  }

  const numerator =
    oldQtyThousandths * oldCost + recvQtyThousandths * recvCost;
  return roundHalfUp(numerator, totalQtyThousandths);
}

