import {
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  CreateSaleDto,
  calculateEffectiveDiscountBp,
  parseQuantityThousandths,
  roundHalfUp,
} from "@universal-pos/shared";

export async function resolveUserMaxDiscountBp(
  tx: any,
  userId: string,
  tenantId: string,
  isOwner?: boolean,
): Promise<number | null> {
  if (isOwner) return null;
  const userRoles = await tx.userRole.findMany({
    where: { userId, tenantId },
    include: { role: true },
  });
  const maxPercent = userRoles.reduce(
    (max: number, ur: any) => Math.max(max, ur.role.maxDiscountPercent ?? 0),
    0,
  );
  return maxPercent * 100;
}

function checkDiscountBounds(discount: any, gross: bigint, label: string) {
  if (discount.type === "fixed") {
    const amt = BigInt(discount.amountMinor ?? 0);
    if (amt < 0n || amt > gross) {
      throw new UnprocessableEntityException({
        code: "DISCOUNT_EXCEEDS_TOTAL",
        message: `${label} discount exceeds subtotal`,
      });
    }
  } else if (discount.type === "percent") {
    const bp = discount.percentBp ?? 0;
    if (bp < 0 || bp > 10000) {
      throw new UnprocessableEntityException({
        code: "DISCOUNT_EXCEEDS_TOTAL",
        message: `${label} discount cannot exceed 100%`,
      });
    }
  }
}

export function validateDiscountsNonNegative(
  dto: CreateSaleDto,
  lineInputs: any[],
) {
  for (const l of lineInputs) {
    if (l.discount) {
      const qtyThousandths = parseQuantityThousandths(l.quantity);
      const gross = roundHalfUp(BigInt(l.unitPriceMinor) * qtyThousandths, 1000n);
      checkDiscountBounds(l.discount, gross, "Line");
    }
  }

  if (dto.billDiscount) {
    const grossSum = lineInputs.reduce((sum, l) => {
      const qtyThousandths = parseQuantityThousandths(l.quantity);
      return sum + roundHalfUp(BigInt(l.unitPriceMinor) * qtyThousandths, 1000n);
    }, 0n);
    checkDiscountBounds(dto.billDiscount, grossSum, "Bill");
  }
}

function computeEffectiveBp(discount: any, gross: bigint): number {
  if (discount.type === "percent") return discount.percentBp ?? 0;
  if (discount.type === "fixed") {
    return calculateEffectiveDiscountBp(BigInt(discount.amountMinor ?? 0), gross);
  }
  return 0;
}

function checkLineDiscountLimits(
  lineInputs: any[],
  userMaxDiscountBp: number,
  canOverrideDiscount: boolean,
  isOffline = false,
): { overrideUsed: boolean; overLimit?: { limitBp: number; attemptedBp: number } } {
  let overrideUsed = false;
  let overLimit: { limitBp: number; attemptedBp: number } | undefined;
  for (const l of lineInputs) {
    if (!l.discount) continue;
    const qtyThousandths = parseQuantityThousandths(l.quantity);
    const unitPrice =
      l.overrideUnitPriceMinor !== undefined
        ? l.overrideUnitPriceMinor
        : l.unitPriceMinor;
    const lineGross = roundHalfUp(BigInt(unitPrice) * qtyThousandths, 1000n);
    const lineEffectiveBp = computeEffectiveBp(l.discount, lineGross);
    if (lineEffectiveBp > userMaxDiscountBp) {
      if (!canOverrideDiscount) {
        if (isOffline) {
          overLimit = { limitBp: userMaxDiscountBp, attemptedBp: lineEffectiveBp };
        } else {
          throw new ForbiddenException({
            code: "LINE_DISCOUNT_LIMIT_EXCEEDED",
            message: `Line discount of ${lineEffectiveBp} bp exceeds role limit of ${userMaxDiscountBp} bp`,
            limitBp: userMaxDiscountBp,
            attemptedBp: lineEffectiveBp,
          });
        }
      }
      overrideUsed = true;
    }
  }
  return { overrideUsed, overLimit };
}

function checkTotalDiscountLimits(
  dto: CreateSaleDto,
  lineInputs: any[],
  userMaxDiscountBp: number,
  canOverrideDiscount: boolean,
  totals?: { grossMinor: bigint; totalDiscountMinor: bigint },
  isOffline = false,
): { overrideUsed: boolean; overLimit?: { limitBp: number; attemptedBp: number } } {
  if (totals && totals.grossMinor > 0n) {
    const totalEffectiveBp = Number(
      (totals.totalDiscountMinor * 10000n + totals.grossMinor - 1n) /
        totals.grossMinor,
    );
    if (totalEffectiveBp > userMaxDiscountBp) {
      if (!canOverrideDiscount) {
        if (isOffline) {
          return { overrideUsed: true, overLimit: { limitBp: userMaxDiscountBp, attemptedBp: totalEffectiveBp } };
        }
        throw new ForbiddenException({
          code: "DISCOUNT_LIMIT_EXCEEDED",
          message: `Effective discount of ${totalEffectiveBp} bp exceeds role limit of ${userMaxDiscountBp} bp`,
          limitBp: userMaxDiscountBp,
          attemptedBp: totalEffectiveBp,
        });
      }
      return { overrideUsed: true };
    }
    return { overrideUsed: false };
  }

  if (dto.billDiscount) {
    const grossSum = lineInputs.reduce((sum, l) => {
      const qtyThousandths = parseQuantityThousandths(l.quantity);
      const unitPrice =
        l.overrideUnitPriceMinor !== undefined
          ? l.overrideUnitPriceMinor
          : l.unitPriceMinor;
      return sum + roundHalfUp(BigInt(unitPrice) * qtyThousandths, 1000n);
    }, 0n);
    const effectiveBp = computeEffectiveBp(dto.billDiscount, grossSum);
    if (effectiveBp > userMaxDiscountBp) {
      if (!canOverrideDiscount) {
        if (isOffline) {
          return { overrideUsed: true, overLimit: { limitBp: userMaxDiscountBp, attemptedBp: effectiveBp } };
        }
        throw new ForbiddenException({
          code: "DISCOUNT_LIMIT_EXCEEDED",
          message: `Bill discount of ${effectiveBp} bp exceeds role limit of ${userMaxDiscountBp} bp`,
          limitBp: userMaxDiscountBp,
          attemptedBp: effectiveBp,
        });
      }
      return { overrideUsed: true };
    }
  }
  return { overrideUsed: false };
}

export function validateUserDiscountLimits(
  dto: CreateSaleDto,
  lineInputs: any[],
  userMaxDiscountBp: number | null,
  canOverrideDiscount: boolean,
  totals?: { grossMinor: bigint; totalDiscountMinor: bigint },
  isOffline = false,
): { discountOverrideUsed: boolean; discountOverLimit?: { limitBp: number; attemptedBp: number } } {
  if (userMaxDiscountBp === null) return { discountOverrideUsed: false };

  const lineResult = checkLineDiscountLimits(
    lineInputs,
    userMaxDiscountBp,
    canOverrideDiscount,
    isOffline,
  );
  const totalResult = checkTotalDiscountLimits(
    dto,
    lineInputs,
    userMaxDiscountBp,
    canOverrideDiscount,
    totals,
    isOffline,
  );

  return {
    discountOverrideUsed: lineResult.overrideUsed || totalResult.overrideUsed,
    discountOverLimit: lineResult.overLimit || totalResult.overLimit,
  };
}

export async function enforceDiscountAndOverrideLimits(
  tx: any,
  userId: string,
  tenantId: string,
  dto: CreateSaleDto,
  lineInputs: any[],
  user?: { isOwner?: boolean; permissions?: string[] },
  totals?: { grossMinor: bigint; totalDiscountMinor: bigint },
  isOffline = false,
) {
  const userMaxDiscountBp = await resolveUserMaxDiscountBp(
    tx,
    userId,
    tenantId,
    user?.isOwner,
  );
  const canOverrideDiscount = Boolean(
    user?.isOwner ||
      user?.permissions?.includes("sale.discount_override") ||
      user?.permissions?.includes("*"),
  );
  const { discountOverrideUsed, discountOverLimit } = validateUserDiscountLimits(
    dto,
    lineInputs,
    userMaxDiscountBp,
    canOverrideDiscount,
    totals,
    isOffline,
  );
  const priceOverrideUsed = dto.items.some(
    (it) => it.overrideUnitPriceMinor !== undefined,
  );
  return { discountOverrideUsed, priceOverrideUsed, discountOverLimit };
}
