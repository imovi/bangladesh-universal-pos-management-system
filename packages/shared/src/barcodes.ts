/**
 * EAN-13 Barcode Utilities
 * 
 * Supports standard GS1 EAN-13 check digit calculation and validation,
 * as well as in-store prefix barcode generation (ranges 200-299).
 */

/**
 * Calculates the EAN-13 check digit for a 12-digit numeric payload string.
 * Uses standard GS1 Modulo-10 algorithm with alternating weights of 1 and 3:
 * - Odd positions (1st, 3rd, 5th, 7th, 9th, 11th; index 0, 2, 4...) have weight 1
 * - Even positions (2nd, 4th, 6th, 8th, 10th, 12th; index 1, 3, 5...) have weight 3
 */
export function calculateEan13CheckDigit(payload12: string): number {
  if (!payload12 || payload12.length !== 12 || !/^\d{12}$/.test(payload12)) {
    throw new Error(`Invalid EAN-13 payload: '${payload12}'. Must be exactly 12 numeric digits.`);
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(payload12.charAt(i), 10);
    // 0-indexed: index 0 (1st digit) -> weight 1, index 1 (2nd digit) -> weight 3
    sum += i % 2 === 0 ? digit : digit * 3;
  }

  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Validates whether a barcode is a syntactically correct 13-digit EAN-13 barcode
 * with a valid check digit.
 */
export function isValidEan13(barcode: string): boolean {
  if (!barcode || typeof barcode !== "string" || barcode.length !== 13 || !/^\d{13}$/.test(barcode)) {
    return false;
  }

  const payload = barcode.slice(0, 12);
  const expectedCheckDigit = calculateEan13CheckDigit(payload);
  const actualCheckDigit = parseInt(barcode.charAt(12), 10);

  return expectedCheckDigit === actualCheckDigit;
}

/**
 * Generates a full 13-digit in-store EAN-13 barcode using a prefix (200-299)
 * and a 9-digit sequence number.
 * 
 * @param prefix 3-digit in-store prefix (200-299). Defaults to 200.
 * @param sequence Sequence number (1 to 999999999).
 * @returns 13-digit complete EAN-13 barcode with check digit.
 */
export function generateEan13(prefix: number | string = 200, sequence: number | bigint): string {
  const prefixStr = String(prefix).padStart(3, "0");
  const prefixNum = parseInt(prefixStr, 10);
  if (prefixNum < 200 || prefixNum > 299) {
    throw new Error(`Invalid in-store EAN-13 prefix: ${prefix}. Must be between 200 and 299.`);
  }

  const seqBig = BigInt(sequence);
  if (seqBig < 1n || seqBig > 999999999n) {
    throw new Error(`Sequence out of bounds: ${sequence}. Must be between 1 and 999999999.`);
  }

  const seqStr = seqBig.toString().padStart(9, "0");
  const payload12 = `${prefixStr}${seqStr}`;
  const checkDigit = calculateEan13CheckDigit(payload12);

  return `${payload12}${checkDigit}`;
}
