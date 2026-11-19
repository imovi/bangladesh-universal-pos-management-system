/**
 * Standard size ordering for clothing and retail apparel:
 * 1. Standard alpha sizes: XS, S, M, L, XL, XXL (plus XXS, 2XL..5XL)
 * 2. Numbers ascending (e.g. 28, 30, 32, 34...)
 * 3. Anything else alphabetically (e.g. "Free Size", "One Size")
 */

export const STANDARD_ALPHA_SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
] as const;

const ALPHA_SIZE_MAP: Record<string, number> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  "2XL": 6,
  "3XL": 7,
  "4XL": 8,
  "5XL": 9,
};

export function compareSizes(a: string, b: string): number {
  const normA = (a || "").trim().toUpperCase();
  const normB = (b || "").trim().toUpperCase();

  const isAlphaA = normA in ALPHA_SIZE_MAP;
  const isAlphaB = normB in ALPHA_SIZE_MAP;

  if (isAlphaA && isAlphaB) {
    return ALPHA_SIZE_MAP[normA] - ALPHA_SIZE_MAP[normB];
  }
  if (isAlphaA) return -1;
  if (isAlphaB) return 1;

  const numA = Number(normA);
  const numB = Number(normB);
  const isNumA = !Number.isNaN(numA) && normA.length > 0;
  const isNumB = !Number.isNaN(numB) && normB.length > 0;

  if (isNumA && isNumB) {
    return numA - numB;
  }
  if (isNumA) return -1;
  if (isNumB) return 1;

  return normA.localeCompare(normB, undefined, { sensitivity: "base", numeric: true });
}

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort(compareSizes);
}
