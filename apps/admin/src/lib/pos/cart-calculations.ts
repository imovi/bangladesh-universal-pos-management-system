import {
  calculateSaleTotals,
  SaleLineItemInput,
  SaleCalculationOptions,
  CalculatedSaleTotals,
  evaluatePromotions,
  PromotionRule,
  PromotionEvaluationLineItem,
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
  productUnitId?: string;
  unitName?: string;
  unitFactor?: number;
  baseUnit?: string;
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
    promotionId?: string;
    promotionLabel?: string;
    promotionDiscountMinor: number;
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
  linePromotionDiscountMinor: number;
  billPromotionId?: string;
  billPromotionLabel?: string;
  billPromotionDiscountMinor: number;
  totalPromotionDiscountMinor: number;
  manualDiscountMinor: number;
  appliedPromotions: Array<{
    id: string;
    name: string;
    type: string;
    discountMinor: number;
    reason: string;
  }>;
  billThresholdHint?: {
    promotionId: string;
    name: string;
    thresholdMinor: number;
    currentSubtotalMinor: number;
    remainingMinor: number;
    hintText: string;
  };
  couponState?: {
    code: string;
    valid: boolean;
    invalidReason?: string;
    savingMinor?: number;
    promotionId?: string;
    promotionName?: string;
  };
}

export function computeCartTotals(
  items: CartItem[],
  options: {
    pricesIncludeTax: boolean;
    billDiscount?: CartLineDiscount;
    promotions?: any[];
    couponCode?: string;
    customerId?: string;
    branchId?: string;
    allowPromotionOverride?: boolean;
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
      linePromotionDiscountMinor: 0,
      billPromotionDiscountMinor: 0,
      totalPromotionDiscountMinor: 0,
      manualDiscountMinor: 0,
      appliedPromotions: [],
    };
  }

  if (options.promotions && options.promotions.length > 0) {
    const promoRules: PromotionRule[] = options.promotions.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      status: p.status,
      priority: p.priority ?? 0,
      stackableWithBill: p.stackableWithBill ?? true,
      membersOnly: Boolean(p.conditions?.membersOnly),
      branchIds: p.conditions?.branchIds,
      minQuantity: p.conditions?.minQuantity,
      startAt: p.startDate || p.startAt || new Date("2020-01-01"),
      endAt: p.endDate || p.endAt || new Date("2030-01-01"),
      daysOfWeek: p.conditions?.daysOfWeek,
      hours: p.conditions?.hours,
      targetType: p.targets?.targetType || p.targetType || "ALL",
      targetIds: p.targets?.targetIds || p.targetIds,
      exclusionIds: p.targets?.exclusionIds || p.exclusionIds,
      config: p.config || {},
      couponRequired: Boolean(p.couponRequired),
      couponCodes: p.couponCodes,
      createdAt: p.createdAt,
    }));

    const evalLines: PromotionEvaluationLineItem[] = items.map((it) => ({
      lineId: it.lineId,
      variantId: it.variantId,
      productId: it.productId,
      unitPriceMinor: it.overrideUnitPriceMinor !== undefined ? it.overrideUnitPriceMinor : it.unitPriceMinor,
      quantity: it.quantity,
      taxRateBp: it.taxRateBp,
      manualDiscount: it.discount
        ? {
            type: it.discount.type,
            amountMinor: it.discount.amountMinor,
            percentBp: it.discount.percentBp,
          }
        : undefined,
    }));

    const evalResult = evaluatePromotions({
      lines: evalLines,
      promotions: promoRules,
      couponCode: options.couponCode,
      customerId: options.customerId,
      branchId: options.branchId,
      allowPromotionOverride: options.allowPromotionOverride,
      manualBillDiscount: options.billDiscount
        ? {
            type: options.billDiscount.type,
            amountMinor: options.billDiscount.amountMinor,
            percentBp: options.billDiscount.percentBp,
          }
        : undefined,
    });

    const grossNum = Number(evalResult.grossMinor);
    const manualDiscNum = Number(evalResult.manualDiscountMinor);
    const effectiveDiscountBp = grossNum > 0 ? Math.ceil((manualDiscNum * 10000) / grossNum) : 0;

    return {
      lines: evalResult.lines.map((l) => ({
        variantId: l.variantId,
        grossMinor: Number(l.grossMinor),
        lineDiscountMinor: Number(l.promotionDiscountMinor + l.manualDiscountMinor),
        allocatedBillDiscountMinor: Number(l.allocatedBillPromotionMinor),
        effectiveLineNetMinor: Number(l.effectiveLineNetMinor),
        taxMinor: Number(l.taxMinor),
        totalMinor: Number(l.totalMinor),
        promotionId: l.promotionId,
        promotionLabel: l.promotionLabel,
        promotionDiscountMinor: Number(l.promotionDiscountMinor),
      })),
      grossMinor: grossNum,
      lineDiscountMinor: Number(evalResult.linePromotionDiscountMinor),
      billDiscountMinor: Number(evalResult.billPromotionDiscountMinor),
      totalDiscountMinor: Number(evalResult.totalDiscountMinor),
      subtotalNetMinor: Number(evalResult.netMinor),
      taxMinor: Number(evalResult.taxMinor),
      totalMinor: Number(evalResult.totalMinor),
      expectedTotalMinor: Number(evalResult.totalMinor),
      effectiveDiscountBp,
      linePromotionDiscountMinor: Number(evalResult.linePromotionDiscountMinor),
      billPromotionId: evalResult.billPromotionId,
      billPromotionLabel: evalResult.billPromotionLabel,
      billPromotionDiscountMinor: Number(evalResult.billPromotionDiscountMinor),
      totalPromotionDiscountMinor: Number(evalResult.totalPromotionDiscountMinor),
      manualDiscountMinor: manualDiscNum,
      appliedPromotions: evalResult.appliedPromotions.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        discountMinor: Number(p.discountMinor),
        reason: p.reason,
      })),
      billThresholdHint: evalResult.billThresholdHint
        ? {
            promotionId: evalResult.billThresholdHint.promotionId,
            name: evalResult.billThresholdHint.name,
            thresholdMinor: Number(evalResult.billThresholdHint.thresholdMinor),
            currentSubtotalMinor: Number(evalResult.billThresholdHint.currentSubtotalMinor),
            remainingMinor: Number(evalResult.billThresholdHint.remainingMinor),
            hintText: evalResult.billThresholdHint.hintText,
          }
        : undefined,
      couponState: evalResult.couponState
        ? {
            code: evalResult.couponState.code,
            valid: evalResult.couponState.valid,
            invalidReason: evalResult.couponState.invalidReason,
            savingMinor: evalResult.couponState.savingMinor ? Number(evalResult.couponState.savingMinor) : undefined,
            promotionId: evalResult.couponState.promotionId,
            promotionName: evalResult.couponState.promotionName,
          }
        : undefined,
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
      promotionDiscountMinor: 0,
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
    linePromotionDiscountMinor: 0,
    billPromotionDiscountMinor: 0,
    totalPromotionDiscountMinor: 0,
    manualDiscountMinor: totalDiscNum,
    appliedPromotions: [],
  };
}

export interface PaymentItemInput {
  paymentMethod: "cash" | "card" | "bkash" | "nagad" | "rocket" | "bank_transfer" | "credit" | "points";
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
  productUnitId?: string;
} {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return { matched: false };

  for (const product of products) {
    if (!product.variants || product.variants.length === 0) continue;

    for (const variant of product.variants) {
      let matchedUnitId: string | undefined = undefined;

      // Check exact barcode match
      const matchedBarcodeObj = (variant.barcodes || []).find((b: any) => {
        const val = typeof b === "string" ? b : b.barcode;
        return val && val.toLowerCase() === trimmed;
      });

      const barcodeMatch = Boolean(matchedBarcodeObj);
      if (barcodeMatch && typeof matchedBarcodeObj === "object" && matchedBarcodeObj.productUnitId) {
        matchedUnitId = matchedBarcodeObj.productUnitId;
      }

      if (!matchedUnitId && barcodeMatch && Array.isArray(variant.barcodeUnits)) {
        const bu = variant.barcodeUnits.find((b: any) => b.barcode && b.barcode.toLowerCase() === trimmed);
        if (bu?.productUnitId) matchedUnitId = bu.productUnitId;
      }

      // Check exact SKU match
      const skuMatch = variant.sku && variant.sku.toLowerCase() === trimmed;

      if (barcodeMatch || skuMatch) {
        const stock = getVariantStock(variant, branchId);
        return {
          matched: true,
          product,
          variant,
          stock,
          productUnitId: matchedUnitId,
        };
      }
    }
  }

  return { matched: false };
}
