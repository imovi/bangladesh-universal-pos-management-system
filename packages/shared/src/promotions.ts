import { roundHalfUp, parseQuantityThousandths, formatQuantityFromThousandths } from "./money.js";

export type PromotionType =
  | "PERCENT_OFF"
  | "AMOUNT_OFF"
  | "FIXED_PRICE"
  | "BUY_X_GET_Y"
  | "BUNDLE_PRICE"
  | "BILL_THRESHOLD";

export type PromotionStatus = "draft" | "active" | "paused" | "ended";

export type TargetType =
  | "ALL"
  | "PRODUCTS"
  | "VARIANTS"
  | "CATEGORIES"
  | "BRANDS"
  | "COLLECTIONS";

export interface PromotionConfig {
  percentBp?: number; // e.g. 2000 = 20.00%
  amountMinor?: bigint | number; // e.g. 30000 = ৳300.00
  fixedPriceMinor?: bigint | number; // e.g. 99900 = ৳999.00
  maxDiscountMinor?: bigint | number; // Cap per line or per bill
  buyQty?: number; // for BUY_X_GET_Y
  getQty?: number; // for BUY_X_GET_Y
  getDiscountPercentBp?: number; // 10000 = 100% free, 5000 = 50% off
  bundleQty?: number; // for BUNDLE_PRICE
  bundlePriceMinor?: bigint | number; // for BUNDLE_PRICE
  thresholdMinor?: bigint | number; // for BILL_THRESHOLD
  discountType?: "PERCENT" | "AMOUNT"; // for BILL_THRESHOLD
}

export interface PromotionRule {
  id: string;
  name: string;
  description?: string;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  stackableWithBill: boolean;
  membersOnly: boolean;
  minQuantity?: number;
  minSpendMinor?: bigint | number;
  usageLimitTotal?: number;
  usageLimitPerCustomer?: number;
  usedCount?: number;
  customerUsageCount?: number;
  startAt: string | Date;
  endAt: string | Date;
  daysOfWeek?: number[]; // [0..6], 0 = Sunday, 5 = Friday
  hours?: { start: string; end: string }; // "HH:mm" in Asia/Dhaka
  branchIds?: string[];
  targetType: TargetType;
  targetIds?: string[];
  exclusionIds?: string[];
  couponRequired?: boolean;
  couponCodes?: string[]; // Allowed coupon codes (uppercase)
  config: PromotionConfig;
  createdAt?: string | Date;
}

export interface PromotionEvaluationLineItem {
  lineId?: string;
  variantId: string;
  productId: string;
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  unitPriceMinor: bigint | number;
  quantity: number | string;
  originalUnitPriceMinor?: bigint | number;
  taxRateBp?: number;
  manualDiscount?: {
    type: "fixed" | "percent";
    amountMinor?: bigint | number;
    percentBp?: number;
  };
}

export interface PromotionEvaluationInput {
  lines: PromotionEvaluationLineItem[];
  promotions: PromotionRule[];
  couponCode?: string;
  customerId?: string;
  branchId?: string;
  evaluationTime?: string | Date;
  timezone?: string; // Default: Asia/Dhaka
  allowPromotionOverride?: boolean; // permission: promotion.override
  manualBillDiscount?: {
    type: "fixed" | "percent";
    amountMinor?: bigint | number;
    percentBp?: number;
  };
}

export interface EvaluatedPromotionLine {
  lineId?: string;
  variantId: string;
  unitPriceMinor: bigint;
  quantityThousandths: bigint;
  quantity: string;
  grossMinor: bigint;
  promotionId?: string;
  promotionLabel?: string;
  promotionDiscountMinor: bigint;
  netAfterPromotionMinor: bigint;
  allocatedBillPromotionMinor: bigint;
  manualDiscountMinor: bigint;
  effectiveLineNetMinor: bigint;
  taxRateBp: number;
  taxMinor: bigint;
  totalMinor: bigint;
  stackableWithBill: boolean;
}

export interface PromotionEvaluationResult {
  grossMinor: bigint;
  linePromotionDiscountMinor: bigint;
  billPromotionId?: string;
  billPromotionLabel?: string;
  billPromotionDiscountMinor: bigint;
  totalPromotionDiscountMinor: bigint;
  manualDiscountMinor: bigint;
  totalDiscountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lines: EvaluatedPromotionLine[];
  appliedPromotions: Array<{
    id: string;
    name: string;
    type: PromotionType;
    discountMinor: bigint;
    reason: string;
  }>;
  couponState?: {
    code: string;
    valid: boolean;
    invalidReason?:
      | "EXPIRED"
      | "NOT_STARTED"
      | "WRONG_BRANCH"
      | "USAGE_LIMIT_EXCEEDED"
      | "CUSTOMER_LIMIT_EXCEEDED"
      | "THRESHOLD_NOT_MET"
      | "INVALID_CODE";
    savingMinor?: bigint;
    promotionId?: string;
    promotionName?: string;
  };
  billThresholdHint?: {
    promotionId: string;
    name: string;
    thresholdMinor: bigint;
    currentSubtotalMinor: bigint;
    remainingMinor: bigint;
    hintText: string;
  };
}

/**
 * Distributes a total integer discount across units/lines proportionally using
 * the Largest Remainder Method (Hamilton-Hare method). Sum of distributed items
 * is guaranteed to exactly equal totalDiscount.
 */
export function distributeProportional(
  items: Array<{ valueMinor: bigint }>,
  totalDiscountMinor: bigint,
): bigint[] {
  if (items.length === 0 || totalDiscountMinor <= 0n) {
    return items.map(() => 0n);
  }

  const totalValue = items.reduce((acc, it) => acc + it.valueMinor, 0n);
  if (totalValue <= 0n) {
    return items.map(() => 0n);
  }

  const effectiveDiscount =
    totalDiscountMinor > totalValue ? totalValue : totalDiscountMinor;

  const shares = items.map((it, index) => {
    const product = it.valueMinor * effectiveDiscount;
    const base = product / totalValue;
    const remainder = product % totalValue;
    return { index, base, remainder };
  });

  const sumBase = shares.reduce((acc, s) => acc + s.base, 0n);
  let discrepancy = Number(effectiveDiscount - sumBase);

  // Sort by remainder descending, then index ascending for tie-breaking
  const sortedShares = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.index - b.index;
  });

  const allocated = new Array<bigint>(items.length).fill(0n);
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
 * Checks whether a promotion is active at the given date/time in Asia/Dhaka timezone.
 */
export function isPromotionTimeActive(
  promo: PromotionRule,
  evalDate: Date,
  tz: string = "Asia/Dhaka",
): { active: boolean; reason?: "NOT_STARTED" | "EXPIRED" } {
  const evalMs = evalDate.getTime();
  const startMs = new Date(promo.startAt).getTime();
  const endMs = new Date(promo.endAt).getTime();

  if (evalMs < startMs) {
    return { active: false, reason: "NOT_STARTED" };
  }
  // Inclusive start, exclusive end
  if (evalMs >= endMs) {
    return { active: false, reason: "EXPIRED" };
  }

  // Day of week in Asia/Dhaka: 0 (Sun) to 6 (Sat)
  if (promo.daysOfWeek && promo.daysOfWeek.length > 0) {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const dayName = formatter.format(evalDate);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = dayMap[dayName] ?? 0;
    if (!promo.daysOfWeek.includes(dayOfWeek)) {
      return { active: false };
    }
  }

  // Hours in Asia/Dhaka: "HH:mm"
  if (promo.hours && promo.hours.start && promo.hours.end) {
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = timeFormatter.formatToParts(evalDate);
    const hh = parts.find((p) => p.type === "hour")?.value || "00";
    const mm = parts.find((p) => p.type === "minute")?.value || "00";
    const currentHHmm = `${hh}:${mm}`;
    if (currentHHmm < promo.hours.start || currentHHmm >= promo.hours.end) {
      return { active: false };
    }
  }

  return { active: true };
}

/**
 * Checks whether an item matches the targeting criteria of a promotion.
 */
export function doesItemMatchTarget(
  item: PromotionEvaluationLineItem,
  promo: PromotionRule,
): boolean {
  // 1. Check exclusions
  if (promo.exclusionIds && promo.exclusionIds.length > 0) {
    if (
      promo.exclusionIds.includes(item.productId) ||
      promo.exclusionIds.includes(item.variantId) ||
      (item.categoryId && promo.exclusionIds.includes(item.categoryId)) ||
      (item.brandId && promo.exclusionIds.includes(item.brandId)) ||
      (item.collectionId && promo.exclusionIds.includes(item.collectionId))
    ) {
      return false;
    }
  }

  // 2. Check target type
  if (promo.targetType === "ALL") return true;

  const tIds = promo.targetIds || [];
  if (tIds.length === 0) return true;

  switch (promo.targetType) {
    case "PRODUCTS":
      return tIds.includes(item.productId);
    case "VARIANTS":
      return tIds.includes(item.variantId);
    case "CATEGORIES":
      return !!item.categoryId && tIds.includes(item.categoryId);
    case "BRANDS":
      return !!item.brandId && tIds.includes(item.brandId);
    case "COLLECTIONS":
      return !!item.collectionId && tIds.includes(item.collectionId);
    default:
      return false;
  }
}

/**
 * Internal representation of a single unit of an item for greedy deal evaluation.
 */
interface DecomposedUnit {
  unitId: string;
  lineIdx: number;
  item: PromotionEvaluationLineItem;
  priceMinor: bigint;
  assignedPromotionId?: string;
  assignedDiscountMinor: bigint;
}

/**
 * Pure evaluation function for promotions and discounts.
 */
export function evaluatePromotions(
  input: PromotionEvaluationInput,
): PromotionEvaluationResult {
  const tz = input.timezone || "Asia/Dhaka";
  const evalDate = input.evaluationTime
    ? new Date(input.evaluationTime)
    : new Date();

  // Normalize input lines
  const normalizedLines = input.lines.map((l) => {
    const qtyThousandths = parseQuantityThousandths(l.quantity);
    const unitPriceMinor = BigInt(l.unitPriceMinor);
    const grossMinor = roundHalfUp(unitPriceMinor * qtyThousandths, 1000n);
    return {
      ...l,
      unitPriceMinor,
      quantityThousandths: qtyThousandths,
      quantity: formatQuantityFromThousandths(qtyThousandths),
      grossMinor,
      taxRateBp: l.taxRateBp ?? 0,
    };
  });

  const grossMinor = normalizedLines.reduce((acc, l) => acc + l.grossMinor, 0n);

  // Filter active promotions
  const activePromos = (input.promotions || []).filter((p) => {
    if (p.status !== "active") return false;
    if (p.branchIds && p.branchIds.length > 0) {
      if (!input.branchId || !p.branchIds.includes(input.branchId)) return false;
    }
    if (p.membersOnly && !input.customerId) return false;
    if (p.usageLimitTotal !== undefined && p.usageLimitTotal !== null) {
      if ((p.usedCount ?? 0) >= p.usageLimitTotal) return false;
    }
    if (
      p.usageLimitPerCustomer !== undefined &&
      p.usageLimitPerCustomer !== null &&
      input.customerId
    ) {
      if ((p.customerUsageCount ?? 0) >= p.usageLimitPerCustomer) return false;
    }
    const timeCheck = isPromotionTimeActive(p, evalDate, tz);
    return timeCheck.active;
  });

  // Separate line promotions and bill promotions
  const linePromos = activePromos
    .filter((p) => p.type !== "BILL_THRESHOLD" && !p.couponRequired)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tA - tB;
    });

  // Decompose cart lines into individual single units (for apparel quantities)
  const units: DecomposedUnit[] = [];
  normalizedLines.forEach((l, lineIdx) => {
    const wholeUnits = Number(l.quantityThousandths / 1000n);
    for (let u = 0; u < wholeUnits; u++) {
      units.push({
        unitId: `${lineIdx}-${u}`,
        lineIdx,
        item: l,
        priceMinor: l.unitPriceMinor,
        assignedDiscountMinor: 0n,
      });
    }
  });

  // 1. Evaluate Line Promotions (at most one per unit, maximizing total customer discount)
  // Candidate evaluations
  type CandidateResult = {
    promo: PromotionRule;
    unitDiscounts: Map<string, bigint>;
    totalDiscount: bigint;
  };

  const evaluateCandidatePromo = (promo: PromotionRule): CandidateResult => {
    const eligibleUnits = units.filter((u) => doesItemMatchTarget(u.item, promo));
    const unitDiscounts = new Map<string, bigint>();
    let totalDiscount = 0n;

    if (promo.minQuantity && eligibleUnits.length < promo.minQuantity) {
      return { promo, unitDiscounts, totalDiscount: 0n };
    }

    if (promo.type === "PERCENT_OFF") {
      const bp = BigInt(promo.config.percentBp ?? 0);
      const cap = promo.config.maxDiscountMinor !== undefined && promo.config.maxDiscountMinor !== null
        ? BigInt(promo.config.maxDiscountMinor)
        : null;

      for (const u of eligibleUnits) {
        let disc = roundHalfUp(u.priceMinor * bp, 10000n);
        if (cap !== null && disc > cap) disc = cap;
        if (disc > u.priceMinor) disc = u.priceMinor;
        unitDiscounts.set(u.unitId, disc);
        totalDiscount += disc;
      }
    } else if (promo.type === "AMOUNT_OFF") {
      const amt = BigInt(promo.config.amountMinor ?? 0);
      for (const u of eligibleUnits) {
        const disc = amt > u.priceMinor ? u.priceMinor : amt;
        unitDiscounts.set(u.unitId, disc);
        totalDiscount += disc;
      }
    } else if (promo.type === "FIXED_PRICE") {
      const fixedPrice = BigInt(promo.config.fixedPriceMinor ?? 0);
      for (const u of eligibleUnits) {
        if (u.priceMinor > fixedPrice) {
          const disc = u.priceMinor - fixedPrice;
          unitDiscounts.set(u.unitId, disc);
          totalDiscount += disc;
        }
      }
    } else if (promo.type === "BUY_X_GET_Y") {
      const buyQty = promo.config.buyQty ?? 2;
      const getQty = promo.config.getQty ?? 1;
      const groupSize = buyQty + getQty;
      const discountPercentBp = BigInt(promo.config.getDiscountPercentBp ?? 10000);

      // Sort eligible units descending by price so high-value items form groups
      const sortedUnits = [...eligibleUnits].sort((a, b) =>
        b.priceMinor > a.priceMinor ? 1 : b.priceMinor < a.priceMinor ? -1 : 0,
      );

      const numGroups = Math.floor(sortedUnits.length / groupSize);
      for (let g = 0; g < numGroups; g++) {
        const group = sortedUnits.slice(g * groupSize, (g + 1) * groupSize);
        // In group, the cheapest getQty units are the "get" units
        const sortedInGroupAsc = [...group].sort((a, b) =>
          a.priceMinor > b.priceMinor ? 1 : a.priceMinor < b.priceMinor ? -1 : 0,
        );
        const getUnits = sortedInGroupAsc.slice(0, getQty);
        let groupDiscount = 0n;
        for (const gu of getUnits) {
          groupDiscount += roundHalfUp(gu.priceMinor * discountPercentBp, 10000n);
        }

        // Spread groupDiscount proportionally across all groupSize units
        const distributed = distributeProportional(
          group.map((u) => ({ valueMinor: u.priceMinor })),
          groupDiscount,
        );

        group.forEach((u, idx) => {
          unitDiscounts.set(u.unitId, distributed[idx]);
        });
        totalDiscount += groupDiscount;
      }
    } else if (promo.type === "BUNDLE_PRICE") {
      const bundleQty = promo.config.bundleQty ?? 3;
      const bundlePrice = BigInt(promo.config.bundlePriceMinor ?? 0);

      // Most expensive units are grouped first
      const sortedUnits = [...eligibleUnits].sort((a, b) =>
        b.priceMinor > a.priceMinor ? 1 : b.priceMinor < a.priceMinor ? -1 : 0,
      );

      const numBundles = Math.floor(sortedUnits.length / bundleQty);
      for (let b = 0; b < numBundles; b++) {
        const bundle = sortedUnits.slice(b * bundleQty, (b + 1) * bundleQty);
        const bundleGross = bundle.reduce((acc, u) => acc + u.priceMinor, 0n);
        if (bundleGross > bundlePrice) {
          const dealDiscount = bundleGross - bundlePrice;
          const distributed = distributeProportional(
            bundle.map((u) => ({ valueMinor: u.priceMinor })),
            dealDiscount,
          );
          bundle.forEach((u, idx) => {
            unitDiscounts.set(u.unitId, distributed[idx]);
          });
          totalDiscount += dealDiscount;
        }
      }
    }

    return { promo, unitDiscounts, totalDiscount };
  };

  // Evaluate all candidate line promotions
  const candidates = linePromos.map(evaluateCandidatePromo);

  // Greedily apply best promotions unit by unit or deal by deal
  // If multiple promotions compete for units, choose the deal/promo that yields the largest discount
  // Sort candidates by total savings descending, priority descending, then createdAt ascending
  candidates.sort((a, b) => {
    if (b.totalDiscount !== a.totalDiscount) {
      return b.totalDiscount > a.totalDiscount ? 1 : -1;
    }
    if (b.promo.priority !== a.promo.priority) {
      return b.promo.priority - a.promo.priority;
    }
    const tA = new Date(a.promo.createdAt || 0).getTime();
    const tB = new Date(b.promo.createdAt || 0).getTime();
    return tA - tB;
  });

  const appliedLinePromosMap = new Map<string, PromotionRule>();

  for (const cand of candidates) {
    if (cand.totalDiscount <= 0n) continue;

    // Check which units can take this promotion without conflicting with an already assigned higher deal
    let canApplyAllUnits = true;
    for (const [unitId, disc] of cand.unitDiscounts.entries()) {
      if (disc > 0n) {
        const u = units.find((x) => x.unitId === unitId);
        if (u && u.assignedPromotionId && u.assignedPromotionId !== cand.promo.id) {
          // If already assigned to another promotion, compare savings
          if (u.assignedDiscountMinor >= disc) {
            canApplyAllUnits = false;
            break;
          }
        }
      }
    }

    if (canApplyAllUnits) {
      for (const [unitId, disc] of cand.unitDiscounts.entries()) {
        const u = units.find((x) => x.unitId === unitId);
        if (u && disc > u.assignedDiscountMinor) {
          u.assignedPromotionId = cand.promo.id;
          u.assignedDiscountMinor = disc;
          appliedLinePromosMap.set(cand.promo.id, cand.promo);
        }
      }
    }
  }

  // Aggregate line promotions back to cart lines
  const linePromotionDiscounts = new Array<bigint>(normalizedLines.length).fill(0n);
  const linePromotionAssigned = new Array<PromotionRule | undefined>(normalizedLines.length);

  for (const u of units) {
    if (u.assignedDiscountMinor > 0n && u.assignedPromotionId) {
      linePromotionDiscounts[u.lineIdx] += u.assignedDiscountMinor;
      if (!linePromotionAssigned[u.lineIdx]) {
        linePromotionAssigned[u.lineIdx] = appliedLinePromosMap.get(u.assignedPromotionId);
      }
    }
  }

  const linePromotionDiscountMinor = linePromotionDiscounts.reduce((acc, d) => acc + d, 0n);

  // 2. Subtotal after line promotions
  const lineNetsAfterLinePromo = normalizedLines.map((l, idx) => {
    const promoDisc = linePromotionDiscounts[idx];
    const net = l.grossMinor - promoDisc;
    const promo = linePromotionAssigned[idx];
    const stackableWithBill = promo ? promo.stackableWithBill : true;
    return {
      lineNetMinor: net > 0n ? net : 0n,
      stackableWithBill,
      lineIdx: idx,
    };
  });

  const postLinePromoSubtotal = lineNetsAfterLinePromo.reduce((acc, l) => acc + l.lineNetMinor, 0n);

  // 3. Bill Promotion & Coupon Evaluation
  // Check bill threshold promotions and coupon promotions
  const allBillPromos = activePromos.filter(
    (p) => p.type === "BILL_THRESHOLD" || p.couponRequired,
  );

  let selectedBillPromo: PromotionRule | undefined = undefined;
  let selectedBillPromoDiscount = 0n;
  let couponState: PromotionEvaluationResult["couponState"] = undefined;

  const billBaseLines = lineNetsAfterLinePromo.filter((l) => l.stackableWithBill);
  const billBaseSubtotal = billBaseLines.reduce((acc, l) => acc + l.lineNetMinor, 0n);

  // Evaluate candidate coupon
  const normalizedCouponCode = input.couponCode?.trim().toUpperCase();
  if (normalizedCouponCode) {
    const matchingCouponPromo = (input.promotions || []).find((p) => {
      if (!p.couponRequired) return false;
      const codes = (p.couponCodes || []).map((c) => c.toUpperCase());
      return codes.includes(normalizedCouponCode);
    });

    if (!matchingCouponPromo) {
      couponState = {
        code: normalizedCouponCode,
        valid: false,
        invalidReason: "INVALID_CODE",
      };
    } else {
      const timeCheck = isPromotionTimeActive(matchingCouponPromo, evalDate, tz);
      if (!timeCheck.active) {
        couponState = {
          code: normalizedCouponCode,
          valid: false,
          invalidReason: timeCheck.reason === "NOT_STARTED" ? "NOT_STARTED" : "EXPIRED",
          promotionId: matchingCouponPromo.id,
          promotionName: matchingCouponPromo.name,
        };
      } else if (
        matchingCouponPromo.branchIds &&
        matchingCouponPromo.branchIds.length > 0 &&
        (!input.branchId || !matchingCouponPromo.branchIds.includes(input.branchId))
      ) {
        couponState = {
          code: normalizedCouponCode,
          valid: false,
          invalidReason: "WRONG_BRANCH",
          promotionId: matchingCouponPromo.id,
          promotionName: matchingCouponPromo.name,
        };
      } else if (
        matchingCouponPromo.usageLimitTotal !== undefined &&
        matchingCouponPromo.usageLimitTotal !== null &&
        (matchingCouponPromo.usedCount ?? 0) >= matchingCouponPromo.usageLimitTotal
      ) {
        couponState = {
          code: normalizedCouponCode,
          valid: false,
          invalidReason: "USAGE_LIMIT_EXCEEDED",
          promotionId: matchingCouponPromo.id,
          promotionName: matchingCouponPromo.name,
        };
      } else if (
        matchingCouponPromo.usageLimitPerCustomer !== undefined &&
        matchingCouponPromo.usageLimitPerCustomer !== null &&
        input.customerId &&
        (matchingCouponPromo.customerUsageCount ?? 0) >= matchingCouponPromo.usageLimitPerCustomer
      ) {
        couponState = {
          code: normalizedCouponCode,
          valid: false,
          invalidReason: "CUSTOMER_LIMIT_EXCEEDED",
          promotionId: matchingCouponPromo.id,
          promotionName: matchingCouponPromo.name,
        };
      } else {
        // Calculate saving
        const threshold = BigInt(matchingCouponPromo.config.thresholdMinor ?? 0);
        if (billBaseSubtotal < threshold) {
          couponState = {
            code: normalizedCouponCode,
            valid: false,
            invalidReason: "THRESHOLD_NOT_MET",
            promotionId: matchingCouponPromo.id,
            promotionName: matchingCouponPromo.name,
          };
        } else {
          let disc = 0n;
          if (matchingCouponPromo.config.discountType === "AMOUNT") {
            const amt = BigInt(matchingCouponPromo.config.amountMinor ?? 0);
            disc = amt > billBaseSubtotal ? billBaseSubtotal : amt;
          } else {
            const bp = BigInt(matchingCouponPromo.config.percentBp ?? 0);
            disc = roundHalfUp(billBaseSubtotal * bp, 10000n);
            if (
              matchingCouponPromo.config.maxDiscountMinor !== undefined &&
              matchingCouponPromo.config.maxDiscountMinor !== null
            ) {
              const cap = BigInt(matchingCouponPromo.config.maxDiscountMinor);
              if (disc > cap) disc = cap;
            }
          }

          couponState = {
            code: normalizedCouponCode,
            valid: true,
            savingMinor: disc,
            promotionId: matchingCouponPromo.id,
            promotionName: matchingCouponPromo.name,
          };

          selectedBillPromo = matchingCouponPromo;
          selectedBillPromoDiscount = disc;
        }
      }
    }
  }

  // Evaluate automatic bill threshold promotions (without coupon requirement)
  const automaticThresholdPromos = allBillPromos.filter(
    (p) => p.type === "BILL_THRESHOLD" && !p.couponRequired,
  );

  let billThresholdHint: PromotionEvaluationResult["billThresholdHint"] = undefined;

  for (const promo of automaticThresholdPromos) {
    const threshold = BigInt(promo.config.thresholdMinor ?? 0);

    // Check hint within 20% of being reached: subtotal >= threshold * 0.8 && subtotal < threshold
    if (threshold > 0n && billBaseSubtotal < threshold) {
      const eightyPercent = (threshold * 80n) / 100n;
      if (billBaseSubtotal >= eightyPercent) {
        const remaining = threshold - billBaseSubtotal;
        const remainingTaka = (Number(remaining) / 100).toFixed(0);
        billThresholdHint = {
          promotionId: promo.id,
          name: promo.name,
          thresholdMinor: threshold,
          currentSubtotalMinor: billBaseSubtotal,
          remainingMinor: remaining,
          hintText: `আর ৳${remainingTaka} কিনলে অফার পাবেন`,
        };
      }
    }

    if (billBaseSubtotal >= threshold) {
      let disc = 0n;
      if (promo.config.discountType === "AMOUNT") {
        const amt = BigInt(promo.config.amountMinor ?? 0);
        disc = amt > billBaseSubtotal ? billBaseSubtotal : amt;
      } else {
        const bp = BigInt(promo.config.percentBp ?? 0);
        disc = roundHalfUp(billBaseSubtotal * bp, 10000n);
        if (
          promo.config.maxDiscountMinor !== undefined &&
          promo.config.maxDiscountMinor !== null
        ) {
          const cap = BigInt(promo.config.maxDiscountMinor);
          if (disc > cap) disc = cap;
        }
      }

      if (disc > selectedBillPromoDiscount) {
        selectedBillPromo = promo;
        selectedBillPromoDiscount = disc;
      }
    }
  }

  // Distribute bill promotion discount across eligible lines using Largest Remainder
  const allocatedBillPromoDiscounts = new Array<bigint>(normalizedLines.length).fill(0n);
  if (selectedBillPromoDiscount > 0n && billBaseLines.length > 0) {
    const distributed = distributeProportional(
      billBaseLines.map((l) => ({ valueMinor: l.lineNetMinor })),
      selectedBillPromoDiscount,
    );
    billBaseLines.forEach((l, idx) => {
      allocatedBillPromoDiscounts[l.lineIdx] = distributed[idx];
    });
  }

  // 4. Cashier Manual Discounts (applied to what is left)
  // Promotion override permission check: cashier cannot manually discount a line that already
  // has a promotion unless allowPromotionOverride is true.
  const manualLineDiscounts = new Array<bigint>(normalizedLines.length).fill(0n);
  normalizedLines.forEach((l, idx) => {
    const promoDisc = linePromotionDiscounts[idx];
    const billPromoDisc = allocatedBillPromoDiscounts[idx];
    const remainingLineNet = l.grossMinor - promoDisc - billPromoDisc;

    if (remainingLineNet > 0n && l.manualDiscount) {
      const hasLinePromo = promoDisc > 0n;
      if (hasLinePromo && !input.allowPromotionOverride) {
        // Line manual discount blocked by missing promotion.override
        manualLineDiscounts[idx] = 0n;
      } else {
        if (l.manualDiscount.type === "fixed") {
          const amt = BigInt(l.manualDiscount.amountMinor ?? 0);
          manualLineDiscounts[idx] = amt > remainingLineNet ? remainingLineNet : amt;
        } else if (l.manualDiscount.type === "percent") {
          const bp = BigInt(l.manualDiscount.percentBp ?? 0);
          const amt = roundHalfUp(remainingLineNet * bp, 10000n);
          manualLineDiscounts[idx] = amt > remainingLineNet ? remainingLineNet : amt;
        }
      }
    }
  });

  const postManualLineSubtotal = normalizedLines.reduce((acc, l, idx) => {
    const net =
      l.grossMinor -
      linePromotionDiscounts[idx] -
      allocatedBillPromoDiscounts[idx] -
      manualLineDiscounts[idx];
    return acc + (net > 0n ? net : 0n);
  }, 0n);

  // Manual bill discount (cashier level)
  let manualBillDiscountMinor = 0n;
  if (input.manualBillDiscount && postManualLineSubtotal > 0n) {
    if (input.manualBillDiscount.type === "fixed") {
      const amt = BigInt(input.manualBillDiscount.amountMinor ?? 0);
      manualBillDiscountMinor = amt > postManualLineSubtotal ? postManualLineSubtotal : amt;
    } else if (input.manualBillDiscount.type === "percent") {
      const bp = BigInt(input.manualBillDiscount.percentBp ?? 0);
      manualBillDiscountMinor = roundHalfUp(postManualLineSubtotal * bp, 10000n);
      if (manualBillDiscountMinor > postManualLineSubtotal) {
        manualBillDiscountMinor = postManualLineSubtotal;
      }
    }
  }

  // Allocate manual bill discount across lines
  const linesForManualBill = normalizedLines.map((l, idx) => ({
    valueMinor:
      l.grossMinor -
      linePromotionDiscounts[idx] -
      allocatedBillPromoDiscounts[idx] -
      manualLineDiscounts[idx],
  }));

  const allocatedManualBill = distributeProportional(
    linesForManualBill,
    manualBillDiscountMinor,
  );

  // Final lines computation with tax
  let totalTaxMinor = 0n;
  const finalLines: EvaluatedPromotionLine[] = normalizedLines.map((l, idx) => {
    const promoDisc = linePromotionDiscounts[idx];
    const billPromoDisc = allocatedBillPromoDiscounts[idx];
    const netAfterPromo = l.grossMinor - promoDisc;
    const manualLine = manualLineDiscounts[idx];
    const manualBill = allocatedManualBill[idx];
    const manualTotal = manualLine + manualBill;
    const effectiveLineNet = netAfterPromo - billPromoDisc - manualTotal;

    const promo = linePromotionAssigned[idx];
    const stackableWithBill = promo ? promo.stackableWithBill : true;

    // Tax calculation on effective line net
    let taxMinor = 0n;
    if (l.taxRateBp > 0 && effectiveLineNet > 0n) {
      taxMinor = roundHalfUp(effectiveLineNet * BigInt(l.taxRateBp), 10000n);
    }
    totalTaxMinor += taxMinor;

    const lineTotal = effectiveLineNet + taxMinor;

    return {
      lineId: l.lineId,
      variantId: l.variantId,
      unitPriceMinor: l.unitPriceMinor,
      quantityThousandths: l.quantityThousandths,
      quantity: l.quantity,
      grossMinor: l.grossMinor,
      promotionId: promo?.id,
      promotionLabel: promo?.name,
      promotionDiscountMinor: promoDisc,
      netAfterPromotionMinor: netAfterPromo,
      allocatedBillPromotionMinor: billPromoDisc,
      manualDiscountMinor: manualTotal,
      effectiveLineNetMinor: effectiveLineNet,
      taxRateBp: l.taxRateBp,
      taxMinor,
      totalMinor: lineTotal,
      stackableWithBill,
    };
  });

  const totalPromotionDiscountMinor =
    linePromotionDiscountMinor + selectedBillPromoDiscount;
  const totalManualDiscountMinor =
    manualLineDiscounts.reduce((a, b) => a + b, 0n) + manualBillDiscountMinor;
  const totalDiscountMinor =
    totalPromotionDiscountMinor + totalManualDiscountMinor;
  const netMinor = grossMinor - totalDiscountMinor;
  const totalMinor = netMinor + totalTaxMinor;

  // Build applied promotions summary
  const appliedPromotions: PromotionEvaluationResult["appliedPromotions"] = [];
  appliedLinePromosMap.forEach((promo) => {
    const disc = finalLines.reduce(
      (acc, l) => (l.promotionId === promo.id ? acc + l.promotionDiscountMinor : acc),
      0n,
    );
    if (disc > 0n) {
      appliedPromotions.push({
        id: promo.id,
        name: promo.name,
        type: promo.type,
        discountMinor: disc,
        reason: `অফার: ${promo.name}`,
      });
    }
  });

  if (selectedBillPromo && selectedBillPromoDiscount > 0n) {
    appliedPromotions.push({
      id: selectedBillPromo.id,
      name: selectedBillPromo.name,
      type: selectedBillPromo.type,
      discountMinor: selectedBillPromoDiscount,
      reason: selectedBillPromo.couponRequired
        ? `কুপন: ${couponState?.code || selectedBillPromo.name}`
        : `বিল অফার: ${selectedBillPromo.name}`,
    });
  }

  return {
    grossMinor,
    linePromotionDiscountMinor,
    billPromotionId: selectedBillPromo?.id,
    billPromotionLabel: selectedBillPromo?.name,
    billPromotionDiscountMinor: selectedBillPromoDiscount,
    totalPromotionDiscountMinor,
    manualDiscountMinor: totalManualDiscountMinor,
    totalDiscountMinor,
    netMinor: netMinor > 0n ? netMinor : 0n,
    taxMinor: totalTaxMinor,
    totalMinor: totalMinor > 0n ? totalMinor : 0n,
    lines: finalLines,
    appliedPromotions,
    couponState,
    billThresholdHint,
  };
}

// ---------------------------------------------------------------------------
// Loyalty Math Helpers
// ---------------------------------------------------------------------------

export interface LoyaltySettingsConfig {
  enabled: boolean;
  earnRateSpendMinor: bigint | number; // Default 10000 = ৳100 per 1 point
  pointValueMinor: bigint | number; // Default 100 = ৳1.00 per 1 point
  minRedeemPoints: number; // Default 100
  maxBillSharePercent: number; // Default 50%
  expiryMonths: number; // Default 12
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettingsConfig = {
  enabled: true,
  earnRateSpendMinor: 10000n,
  pointValueMinor: 100n,
  minRedeemPoints: 100,
  maxBillSharePercent: 50,
  expiryMonths: 12,
};

/**
 * Calculates loyalty points earned on a sale.
 * Base = net paid amount minus portion paid with points.
 * Rounded down to whole integer points.
 */
export function earnPoints(
  netPaidMinor: bigint | number,
  pointsRedeemedMinor: bigint | number = 0n,
  earnRateSpendMinor: bigint | number = 10000n,
): number {
  const netPaid = BigInt(netPaidMinor);
  const pointsRedeemed = BigInt(pointsRedeemedMinor);
  const earnRate = BigInt(earnRateSpendMinor);

  if (earnRate <= 0n) return 0;
  const base = netPaid - pointsRedeemed;
  if (base <= 0n) return 0;

  return Number(base / earnRate);
}

/**
 * Calculates the maximum points redeemable on a given bill total.
 */
export function maxRedeemablePoints(
  billTotalMinor: bigint | number,
  customerPointsBalance: number,
  settings: Partial<LoyaltySettingsConfig> = {},
): { maxPoints: number; maxDiscountMinor: bigint } {
  const cfg = { ...DEFAULT_LOYALTY_SETTINGS, ...settings };
  const pointVal = BigInt(cfg.pointValueMinor);
  const billTotal = BigInt(billTotalMinor);

  if (!cfg.enabled || customerPointsBalance < cfg.minRedeemPoints || billTotal <= 0n || pointVal <= 0n) {
    return { maxPoints: 0, maxDiscountMinor: 0n };
  }

  // Maximum spend allowed by bill share percentage
  const maxSpendAllowed = (billTotal * BigInt(cfg.maxBillSharePercent)) / 100n;
  const maxPointsByBillShare = Number(maxSpendAllowed / pointVal);

  const usablePoints = Math.max(0, Math.min(customerPointsBalance, maxPointsByBillShare));
  const maxDiscountMinor = BigInt(usablePoints) * pointVal;

  return {
    maxPoints: usablePoints,
    maxDiscountMinor,
  };
}

/**
 * Calculates loyalty points to reverse upon a return, proportional to the returned net amount.
 */
export function reversePoints(
  pointsEarned: number,
  returnNetMinor: bigint | number,
  originalSaleNetMinor: bigint | number,
): number {
  if (pointsEarned <= 0) return 0;
  const retNet = BigInt(returnNetMinor);
  const origNet = BigInt(originalSaleNetMinor);

  if (origNet <= 0n || retNet <= 0n) return 0;
  if (retNet >= origNet) return pointsEarned;

  const reversed = Number(roundHalfUp(BigInt(pointsEarned) * retNet, origNet));
  return Math.min(pointsEarned, reversed);
}
