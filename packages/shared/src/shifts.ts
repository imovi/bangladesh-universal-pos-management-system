import { SALE_PAYMENT_METHODS, type SalePaymentMethod } from "./schemas/sales.schemas.js";

/**
 * Unified shift cash calculation engine for Universal POS.
 * Formulated with integer minor units (poisha).
 * Shared by ShiftsService.close and ReportsService.getShiftReport.
 */

export type PaymentMethodTotalsMinor = Record<SalePaymentMethod, bigint>;

export interface ShiftPaymentInput {
  paymentMethod: string;
  amountMinor: bigint | number;
}

export interface ShiftSaleInput {
  status: string;
  changeMinor?: bigint | number | null;
  payments: ShiftPaymentInput[];
}

export interface ShiftCashMovementInput {
  type: string;
  amountMinor: bigint | number;
}

export interface ShiftCalculationInput {
  openingCashMinor: bigint | number;
  cashMovements: ShiftCashMovementInput[];
  sales: ShiftSaleInput[];
}

export interface ShiftCashCalculationResult {
  openingCashMinor: bigint;
  cashPaymentsMinor: bigint;
  changeGivenMinor: bigint;
  netCashSalesMinor: bigint;
  cashInMinor: bigint;
  cashOutMinor: bigint;
  netCashFlowMinor: bigint;
  expectedCashMinor: bigint;
  paymentMethodTotalsMinor: PaymentMethodTotalsMinor;
  /** @deprecated Use paymentMethodTotalsMinor.card */
  cardSalesMinor: bigint;
  /** @deprecated Use paymentMethodTotalsMinor.bkash */
  bkashSalesMinor: bigint;
  /** @deprecated Use paymentMethodTotalsMinor */
  otherSalesMinor: bigint;
  completedSalesCount: number;
}

function aggregateSales(sales: ShiftSaleInput[]) {
  let cashPayments = 0n,
    changeGiven = 0n,
    cardSales = 0n,
    bkashSales = 0n,
    otherSales = 0n,
    completedCount = 0;

  const paymentMethodTotals: Record<SalePaymentMethod, bigint> = Object.fromEntries(
    SALE_PAYMENT_METHODS.map((m) => [m, 0n]),
  ) as Record<SalePaymentMethod, bigint>;

  for (const s of sales) {
    if (s.status !== "completed") continue;
    completedCount++;
    changeGiven += BigInt(s.changeMinor ?? 0);
    for (const p of s.payments) {
      const amt = BigInt(p.amountMinor);
      const method = p.paymentMethod as SalePaymentMethod;
      if (method in paymentMethodTotals) {
        paymentMethodTotals[method] += amt;
      }
      if (p.paymentMethod === "cash") cashPayments += amt;
      else if (p.paymentMethod === "card") cardSales += amt;
      else if (["bkash", "nagad", "rocket"].includes(p.paymentMethod)) bkashSales += amt;
      else otherSales += amt;
    }
  }
  return {
    cashPayments,
    changeGiven,
    cardSales,
    bkashSales,
    otherSales,
    completedCount,
    paymentMethodTotals,
  };
}

function aggregateMovements(movements: ShiftCashMovementInput[]) {
  let cashIn = 0n,
    cashOut = 0n;
  for (const m of movements) {
    const amt = BigInt(m.amountMinor);
    if (m.type === "cash_in") cashIn += amt;
    else if (m.type === "cash_out") cashOut += amt;
  }
  return { cashIn, cashOut };
}

/**
 * Computes expected cash from the ground up:
 * expectedCash = openingCash + cashPaymentsOfCompletedSales - changeGiven - cashOut + cashIn.
 */
export function calculateShiftCashTotals(
  input: ShiftCalculationInput,
): ShiftCashCalculationResult {
  const openingCash = BigInt(input.openingCashMinor);
  const salesAgg = aggregateSales(input.sales);
  const movAgg = aggregateMovements(input.cashMovements);

  const netCashSales = salesAgg.cashPayments - salesAgg.changeGiven;
  const netCashFlow = netCashSales + movAgg.cashIn - movAgg.cashOut;
  const expectedCash = openingCash + netCashFlow;

  return {
    openingCashMinor: openingCash,
    cashPaymentsMinor: salesAgg.cashPayments,
    changeGivenMinor: salesAgg.changeGiven,
    netCashSalesMinor: netCashSales,
    cashInMinor: movAgg.cashIn,
    cashOutMinor: movAgg.cashOut,
    netCashFlowMinor: netCashFlow,
    expectedCashMinor: expectedCash,
    paymentMethodTotalsMinor: salesAgg.paymentMethodTotals,
    cardSalesMinor: salesAgg.cardSales,
    bkashSalesMinor: salesAgg.bkashSales,
    otherSalesMinor: salesAgg.otherSales,
    completedSalesCount: salesAgg.completedCount,
  };
}
