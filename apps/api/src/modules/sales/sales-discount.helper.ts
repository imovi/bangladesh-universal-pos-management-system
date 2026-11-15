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

export function validateUserDiscountLimits(
  dto: CreateSaleDto,
  lineInputs: any[],
  userMaxDiscountBp: number | null,
  canOverrideDiscount: boolean,
): boolean {
  if (userMaxDiscountBp === null) return false;

  let overrideUsed = false;
  for (const l of lineInputs) {
    if (!l.discount) continue;
    const qtyThousandths = parseQuantityThousandths(l.quantity);
    const gross = roundHalfUp(BigInt(l.unitPriceMinor) * qtyThousandths, 1000n);
    const effectiveBp = computeEffectiveBp(l.discount, gross);
    if (effectiveBp > userMaxDiscountBp) {
      if (!canOverrideDiscount) {
        throw new ForbiddenException(`Discount of ${effectiveBp} bp exceeds role limit of ${userMaxDiscountBp} bp`);
      }
      overrideUsed = true;
    }
  }

  if (dto.billDiscount) {
    const grossSum = lineInputs.reduce((sum, l) => {
      const qtyThousandths = parseQuantityThousandths(l.quantity);
      return sum + roundHalfUp(BigInt(l.unitPriceMinor) * qtyThousandths, 1000n);
    }, 0n);
    const effectiveBp = computeEffectiveBp(dto.billDiscount, grossSum);
    if (effectiveBp > userMaxDiscountBp) {
      if (!canOverrideDiscount) {
        throw new ForbiddenException(`Bill discount of ${effectiveBp} bp exceeds role limit of ${userMaxDiscountBp} bp`);
      }
      overrideUsed = true;
    }
  }

  return overrideUsed;
}

export async function enforceDiscountAndOverrideLimits(
  tx: any,
  userId: string,
  tenantId: string,
  dto: CreateSaleDto,
  lineInputs: any[],
  user?: { isOwner?: boolean; permissions?: string[] },
) {
  const userMaxDiscountBp = await resolveUserMaxDiscountBp(tx, userId, tenantId, user?.isOwner);
  const canOverrideDiscount = Boolean(
    user?.isOwner || user?.permissions?.includes("sale.discount_override") || user?.permissions?.includes("*"),
  );
  const discountOverrideUsed = validateUserDiscountLimits(dto, lineInputs, userMaxDiscountBp, canOverrideDiscount);
  const priceOverrideUsed = dto.items.some((it) => it.overrideUnitPriceMinor !== undefined);
  return { discountOverrideUsed, priceOverrideUsed };
}
