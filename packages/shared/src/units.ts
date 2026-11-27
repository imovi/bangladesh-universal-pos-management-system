import { parseQuantityThousandths, roundHalfUp, formatQuantityFromThousandths } from "./money.js";

export interface BaseUnitDefinition {
  code: string;
  nameBn: string;
  nameEn: string;
}

export const BASE_UNITS: readonly BaseUnitDefinition[] = [
  { code: "pcs", nameBn: "পিস", nameEn: "piece" },
  { code: "kg", nameBn: "কেজি", nameEn: "kg" },
  { code: "g", nameBn: "গ্রাম", nameEn: "gram" },
  { code: "l", nameBn: "লিটার", nameEn: "liter" },
  { code: "ml", nameBn: "মিলি", nameEn: "ml" },
  { code: "m", nameBn: "মিটার", nameEn: "meter" },
  { code: "ft", nameBn: "ফুট", nameEn: "foot" },
  { code: "dozen", nameBn: "ডজন", nameEn: "dozen" },
  { code: "tablet", nameBn: "ট্যাবলেট", nameEn: "tablet" },
  { code: "capsule", nameBn: "ক্যাপসুল", nameEn: "capsule" },
] as const;

export type BaseUnitCode = (typeof BASE_UNITS)[number]["code"];

export const BASE_UNIT_CODES: readonly BaseUnitCode[] = BASE_UNITS.map((u) => u.code as BaseUnitCode);

export function isValidBaseUnit(code: string): code is BaseUnitCode {
  return BASE_UNIT_CODES.includes(code as BaseUnitCode);
}

export function getBaseUnit(code: string): BaseUnitDefinition | undefined {
  return BASE_UNITS.find((u) => u.code === code);
}

/**
 * Computes base quantity in integer thousandths (DECIMAL(14,3)) rounded half up.
 * baseQuantity = quantity * factor
 */
export function computeBaseQuantityThousandths(
  quantity: number | string,
  factor: number | string,
): bigint {
  const qtyThousandths = parseQuantityThousandths(String(quantity));
  const factorThousandths = parseQuantityThousandths(String(factor));
  // (qtyThousandths * factorThousandths) has scale 10^6. Divide by 1000n to get 10^3 scale.
  return roundHalfUp(qtyThousandths * factorThousandths, 1000n);
}

/**
 * Computes base quantity formatted as a 3-decimal string (e.g. "2.500").
 */
export function computeBaseQuantityString(
  quantity: number | string,
  factor: number | string,
): string {
  const thousandths = computeBaseQuantityThousandths(quantity, factor);
  return formatQuantityFromThousandths(thousandths);
}

/**
 * Computes base quantity as a JavaScript number rounded to 3 decimals.
 */
export function computeBaseQuantity(
  quantity: number | string,
  factor: number | string,
): number {
  const str = computeBaseQuantityString(quantity, factor);
  return parseFloat(str);
}

/**
 * Computes derived unit price in poisha (minor units) from variant price and unit factor.
 * price = variantPriceMinor * factor, rounded to the nearest poisha half up.
 */
export function computeUnitDerivedPriceMinor(
  variantPriceMinor: bigint | number,
  factor: number | string,
): bigint {
  const basePriceMinor = BigInt(variantPriceMinor);
  const factorThousandths = parseQuantityThousandths(String(factor));
  return roundHalfUp(basePriceMinor * factorThousandths, 1000n);
}

export function toBengaliNumerals(val: string | number): string {
  const digits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  return String(val).replace(/[0-9]/g, (d) => digits[parseInt(d, 10)]);
}

export function formatStockWithBiggestUnit(
  qty: number,
  baseUnitCode: string = "pcs",
  activeUnits?: Array<{ name: string; factor: number | string }>,
  locale: "bn" | "en" = "bn",
): string {
  const baseDef = getBaseUnit(baseUnitCode);
  const baseUnitLabel = locale === "bn" ? (baseDef?.nameBn || baseUnitCode) : (baseDef?.nameEn || baseUnitCode);

  const sortedUnits = (activeUnits || [])
    .map((u) => ({ name: u.name, factor: Number(u.factor) }))
    .filter((u) => u.factor > 1)
    .sort((a, b) => b.factor - a.factor);

  const formatNum = (num: number) => {
    const str = Number(num.toFixed(3)).toString();
    return locale === "bn" ? toBengaliNumerals(str) : str;
  };

  const baseText = `${formatNum(qty)} ${baseUnitLabel}`;

  if (sortedUnits.length === 0 || qty <= 0) {
    return baseText;
  }

  const biggest = sortedUnits[0];
  const count = Math.floor(qty / biggest.factor);
  const remainder = Number((qty - count * biggest.factor).toFixed(3));

  if (count <= 0) {
    return baseText;
  }

  let breakdown = "";
  if (remainder > 0) {
    breakdown = `${formatNum(count)} ${biggest.name} ${formatNum(remainder)} ${baseUnitLabel}`;
  } else {
    breakdown = `${formatNum(count)} ${biggest.name}`;
  }

  return `${baseText} (${breakdown})`;
}
