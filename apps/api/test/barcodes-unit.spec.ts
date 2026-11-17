import { describe, it, expect } from "vitest";
import {
  calculateEan13CheckDigit,
  isValidEan13,
  generateEan13,
} from "@universal-pos/shared";

describe("Milestone C4: EAN-13 Barcode Unit Tests", () => {
  describe("calculateEan13CheckDigit with standard GS1 examples", () => {
    it("computes correct check digit for 400638133393 (expected 1)", () => {
      expect(calculateEan13CheckDigit("400638133393")).toBe(1);
    });

    it("computes correct check digit for 978020137962 (expected 4)", () => {
      expect(calculateEan13CheckDigit("978020137962")).toBe(4);
    });

    it("computes correct check digit for 200000000001 (expected 5)", () => {
      expect(calculateEan13CheckDigit("200000000001")).toBe(5);
    });

    it("computes correct check digit for 200123456789 (expected 3)", () => {
      expect(calculateEan13CheckDigit("200123456789")).toBe(3);
    });

    it("computes correct check digit for 590123412345 (expected 7)", () => {
      expect(calculateEan13CheckDigit("590123412345")).toBe(7);
    });

    it("handles checksum sum ending in 0 (check digit is 0)", () => {
      // 400638133393 -> sum is 89 (digit 1). If we change 1st digit from 4 to 5, sum is 90 -> check digit 0
      expect(calculateEan13CheckDigit("500638133393")).toBe(0);
    });

    it("throws on invalid payload lengths or non-numeric characters", () => {
      expect(() => calculateEan13CheckDigit("123")).toThrow();
      expect(() => calculateEan13CheckDigit("1234567890123")).toThrow();
      expect(() => calculateEan13CheckDigit("12345678901A")).toThrow();
      expect(() => calculateEan13CheckDigit("")).toThrow();
    });
  });

  describe("isValidEan13 validator", () => {
    it("validates known authentic EAN-13 barcodes", () => {
      expect(isValidEan13("4006381333931")).toBe(true);
      expect(isValidEan13("9780201379624")).toBe(true);
      expect(isValidEan13("2000000000015")).toBe(true);
      expect(isValidEan13("2001234567893")).toBe(true);
      expect(isValidEan13("5901234123457")).toBe(true);
    });

    it("rejects altered or corrupted check digits", () => {
      expect(isValidEan13("4006381333932")).toBe(false);
      expect(isValidEan13("9780201379620")).toBe(false);
      expect(isValidEan13("2000000000010")).toBe(false);
    });

    it("rejects invalid lengths or non-digits", () => {
      expect(isValidEan13("123456789012")).toBe(false);
      expect(isValidEan13("12345678901234")).toBe(false);
      expect(isValidEan13("400638133393A")).toBe(false);
      expect(isValidEan13("")).toBe(false);
    });
  });

  describe("generateEan13 in-store generator (200-299 range)", () => {
    it("generates correct in-store barcode with default prefix 200", () => {
      const barcode = generateEan13(200, 1);
      expect(barcode).toBe("2000000000015");
      expect(isValidEan13(barcode)).toBe(true);
    });

    it("generates correct in-store barcode with custom prefix in range 200-299", () => {
      const barcode = generateEan13(245, 12345);
      expect(barcode.startsWith("245000012345")).toBe(true);
      expect(barcode).toHaveLength(13);
      expect(isValidEan13(barcode)).toBe(true);
    });

    it("rejects prefixes outside the 200-299 in-store range", () => {
      expect(() => generateEan13(199, 1)).toThrow("Must be between 200 and 299");
      expect(() => generateEan13(300, 1)).toThrow("Must be between 200 and 299");
    });

    it("rejects out-of-bound sequence numbers", () => {
      expect(() => generateEan13(200, 0)).toThrow("Must be between 1 and 999999999");
      expect(() => generateEan13(200, 1000000000n)).toThrow("Must be between 1 and 999999999");
    });
  });
});
