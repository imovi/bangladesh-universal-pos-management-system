import {
  calculateSaleTotals,
  SaleLineItemInput,
  SaleCalculationOptions,
  CalculatedSaleTotals,
} from "@universal-pos/shared";
import { getVariantStock } from "./variant-matrix";

export interface CartLineDiscount {
  type: "fixed" | "percent";
  amountMinor?: number;
  percentBp?: number;
}

export interface CartItem {
  lineId?: string;
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  size?: string;
  color?: string;
  unitPriceMinor: number;
  overrideUnitPriceMinor?: number;
  quantity: number;
  taxRateBp: number;
  discount?: CartLineDiscount;
  availableStock?: number;
  allowDecimals?: boolean;
}

export interface CartTotalsResult {
  lines: Array<{
    variantId: string;
    grossMinor: number;
    lineDiscountMinor: number;
    allocatedBillDiscountMinor: number;
    effectiveLineNetMinor: number;
    taxMinor: number;
    totalMinor: number;
  }>;
  grossMinor: number;
  lineDiscountMinor: number;
  billDiscountMinor: number;
  totalDiscountMinor: number;
  subtotalNetMinor: number;
  taxMinor: number;
  totalMinor: number;
  expectedTotalMinor: number;
  effectiveDiscountBp: number;
}

export function computeCartTotals(
  items: CartItem[],
  options: {
    pricesIncludeTax: boolean;
    billDiscount?: CartLineDiscount;
  },
): CartTotalsResult {
  if (items.length === 0) {
    return {
      lines: [],
      grossMinor: 0,
      lineDiscountMinor: 0,
      billDiscountMinor: 0,
      totalDiscountMinor: 0,
      subtotalNetMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      expectedTotalMinor: 0,
      effectiveDiscountBp: 0,
    };
  }

  const saleLineInputs: SaleLineItemInput[] = items.map((it) => ({
    lineId: it.lineId,
    variantId: it.variantId,
    unitPriceMinor: it.overrideUnitPriceMinor !== undefined ? it.overrideUnitPriceMinor : it.unitPriceMinor,
    quantity: it.quantity,
    taxRateBp: it.taxRateBp,
    discount: it.discount
      ? {
          type: it.discount.type,
          amountMinor: it.discount.amountMinor,
          percentBp: it.discount.percentBp,
        }
      : undefined,
  }));

  const calcOptions: SaleCalculationOptions = {
    pricesIncludeTax: options.pricesIncludeTax,
    billDiscount: options.billDiscount
      ? {
          type: options.billDiscount.type,
          amountMinor: options.billDiscount.amountMinor,
          percentBp: options.billDiscount.percentBp,
        }
      : undefined,
  };

  const calculated: CalculatedSaleTotals = calculateSaleTotals(saleLineInputs, calcOptions);

  const grossNum = Number(calculated.grossMinor);
  const totalDiscNum = Number(calculated.totalDiscountMinor);
  const effectiveDiscountBp =
    grossNum > 0 ? Math.ceil((totalDiscNum * 10000) / grossNum) : 0;

  return {
    lines: calculated.lines.map((l) => ({
      variantId: l.variantId,
      grossMinor: Number(l.grossMinor),
      lineDiscountMinor: Number(l.lineDiscountMinor),
      allocatedBillDiscountMinor: Number(l.allocatedBillDiscountMinor),
      effectiveLineNetMinor: Number(l.effectiveLineNetMinor),
      taxMinor: Number(l.taxMinor),
      totalMinor: Number(l.totalMinor),
    })),
    grossMinor: grossNum,
    lineDiscountMinor: Number(calculated.lineDiscountMinor),
    billDiscountMinor: Number(calculated.billDiscountMinor),
    totalDiscountMinor: totalDiscNum,
    subtotalNetMinor: Number(calculated.netMinor),
    taxMinor: Number(calculated.taxMinor),
    totalMinor: Number(calculated.totalMinor),
    expectedTotalMinor: Number(calculated.totalMinor),
    effectiveDiscountBp,
  };
}

export interface PaymentItemInput {
  paymentMethod: "cash" | "card" | "bkash" | "nagad" | "rocket" | "bank_transfer";
  amountMinor: number;
  reference?: string;
}

export interface PaymentCalculationResult {
  totalPaidMinor: number;
  cashPaidMinor: number;
  nonCashPaidMinor: number;
  balanceDueMinor: number;
  changeDueMinor: number;
  isCovered: boolean;
  isValid: boolean;
  errorMessage?: string;
}

export function calculatePaymentChange(
  totalPayableMinor: number,
  payments: PaymentItemInput[],
): PaymentCalculationResult {
  const totalPaidMinor = payments.reduce((sum, p) => sum + (p.amountMinor || 0), 0);
  const cashPaidMinor = payments
    .filter((p) => p.paymentMethod === "cash")
    .reduce((sum, p) => sum + (p.amountMinor || 0), 0);
  const nonCashPaidMinor = totalPaidMinor - cashPaidMinor;

  const isCovered = totalPaidMinor >= totalPayableMinor;
  const balanceDueMinor = Math.max(0, totalPayableMinor - totalPaidMinor);
  const changeDueMinor = isCovered ? totalPaidMinor - totalPayableMinor : 0;

  // Rule: Non-cash payments cannot exceed total amount due; change only against cash
  let isValid = true;
  let errorMessage: string | undefined;

  if (changeDueMinor > cashPaidMinor) {
    isValid = false;
    errorMessage = "Non-cash payments cannot exceed amount due. Change is given only against cash.";
  }

  return {
    totalPaidMinor,
    cashPaidMinor,
    nonCashPaidMinor,
    balanceDueMinor,
    changeDueMinor,
    isCovered,
    isValid,
    errorMessage,
  };
}

export function matchBarcodeOrSku(
  query: string,
  products: any[],
  branchId?: string,
): {
  matched: boolean;
  product?: any;
  variant?: any;
  stock?: number;
} {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return { matched: false };

  for (const product of products) {
    if (!product.variants || product.variants.length === 0) continue;

    for (const variant of product.variants) {
      // Check exact barcode match
      const barcodeMatch = (variant.barcodes || []).some(
        (b: any) => b.barcode && b.barcode.toLowerCase() === trimmed,
      );

      // Check exact SKU match
      const skuMatch = variant.sku && variant.sku.toLowerCase() === trimmed;

      if (barcodeMatch || skuMatch) {
        const stock = getVariantStock(variant, branchId);
        return {
          matched: true,
          product,
          variant,
          stock,
        };
      }
    }
  }

  return { matched: false };
}
