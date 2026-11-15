import { createHash } from "node:crypto";
import { CreateSaleDto } from "@universal-pos/shared";

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(",")}]`;
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`);
  return `{${pairs.join(",")}}`;
}

function normalizeDiscount(discount?: CreateSaleDto["billDiscount"]) {
  if (!discount) return null;
  return {
    type: discount.type,
    amountMinor:
      discount.amountMinor !== undefined ? Number(discount.amountMinor) : null,
    percentBp:
      discount.percentBp !== undefined ? Number(discount.percentBp) : null,
  };
}

export function computeSalePayloadHash(dto: CreateSaleDto): string {
  const normalized = {
    id: dto.id,
    shiftId: dto.shiftId,
    branchId: dto.branchId,
    customerId: dto.customerId ?? null,
    notes: dto.notes ?? null,
    expectedTotalMinor: Number(dto.expectedTotalMinor),
    billDiscount: normalizeDiscount(dto.billDiscount),
    items: dto.items.map((it) => ({
      lineId: it.lineId ?? null,
      variantId: it.variantId,
      quantity: Number(it.quantity),
      overrideUnitPriceMinor:
        it.overrideUnitPriceMinor !== undefined
          ? Number(it.overrideUnitPriceMinor)
          : null,
      discount: normalizeDiscount(it.discount),
    })),
    payments: dto.payments.map((p) => ({
      paymentMethod: p.paymentMethod,
      amountMinor: Number(p.amountMinor),
      reference: p.reference ?? null,
    })),
  };

  return createHash("sha256")
    .update(canonicalStringify(normalized))
    .digest("hex");
}

export function isSameSalePayload(existing: any, dto: CreateSaleDto): boolean {
  if (BigInt(dto.expectedTotalMinor) !== existing.totalMinor) return false;
  if (dto.items.length !== existing.items?.length) return false;
  return dto.items.every((incoming) => {
    const match = existing.items?.find(
      (it: any) => it.variantId === incoming.variantId,
    );
    return match && Number(match.quantity) === incoming.quantity;
  });
}

export function matchesSalePayload(
  existing: any,
  payloadHash: string,
  dto: CreateSaleDto,
): boolean {
  if (existing.requestPayloadHash) {
    return existing.requestPayloadHash === payloadHash;
  }
  return isSameSalePayload(existing, dto);
}
