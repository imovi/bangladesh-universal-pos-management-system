import { describe, it, expect } from "vitest";
import {
  BASE_UNITS,
  BASE_UNIT_CODES,
  isValidBaseUnit,
  getBaseUnit,
  computeBaseQuantity,
  computeBaseQuantityString,
  computeBaseQuantityThousandths,
  computeUnitDerivedPriceMinor,
  formatStockWithBiggestUnit,
} from "../src/units.js";

describe("units shared utilities", () => {
  it("defines the 10 required base units with Bangla and English names", () => {
    expect(BASE_UNITS).toHaveLength(10);
    const expectedCodes = ["pcs", "kg", "g", "l", "ml", "m", "ft", "dozen", "tablet", "capsule"];
    expect(BASE_UNIT_CODES).toEqual(expectedCodes);

    expect(getBaseUnit("pcs")).toEqual({ code: "pcs", nameBn: "পিস", nameEn: "piece" });
    expect(getBaseUnit("kg")).toEqual({ code: "kg", nameBn: "কেজি", nameEn: "kg" });
    expect(getBaseUnit("g")).toEqual({ code: "g", nameBn: "গ্রাম", nameEn: "gram" });
    expect(getBaseUnit("l")).toEqual({ code: "l", nameBn: "লিটার", nameEn: "liter" });
    expect(getBaseUnit("ml")).toEqual({ code: "ml", nameBn: "মিলি", nameEn: "ml" });
    expect(getBaseUnit("m")).toEqual({ code: "m", nameBn: "মিটার", nameEn: "meter" });
    expect(getBaseUnit("ft")).toEqual({ code: "ft", nameBn: "ফুট", nameEn: "foot" });
    expect(getBaseUnit("dozen")).toEqual({ code: "dozen", nameBn: "ডজন", nameEn: "dozen" });
    expect(getBaseUnit("tablet")).toEqual({ code: "tablet", nameBn: "ট্যাবলেট", nameEn: "tablet" });
    expect(getBaseUnit("capsule")).toEqual({ code: "capsule", nameBn: "ক্যাপসুল", nameEn: "capsule" });
  });

  it("validates base unit codes", () => {
    expect(isValidBaseUnit("pcs")).toBe(true);
    expect(isValidBaseUnit("kg")).toBe(true);
    expect(isValidBaseUnit("l")).toBe(true);
    expect(isValidBaseUnit("unknown")).toBe(false);
    expect(isValidBaseUnit("")).toBe(false);
  });

  it("computes base quantity accurately with half-up rounding to 3 decimals", () => {
    // 2 drums at 200 liters factor = 400 liters
    expect(computeBaseQuantity(2, 200)).toBe(400);
    expect(computeBaseQuantityString(2, 200)).toBe("400.000");
    expect(computeBaseQuantityThousandths(2, 200)).toBe(400000n);

    // 2.5 kg at 1 kg factor = 2.5 kg
    expect(computeBaseQuantity(2.5, 1)).toBe(2.5);
    expect(computeBaseQuantityString("2.500", "1.000")).toBe("2.500");

    // 5 cans of 5 liters = 25 liters
    expect(computeBaseQuantity(5, 5)).toBe(25);

    // Rounding half-up test: 0.0005 -> 0.001
    // qty = 0.01, factor = 0.05 -> 0.0005 -> rounds to 0.001
    expect(computeBaseQuantityString("0.010", "0.050")).toBe("0.001");
  });

  it("computes derived unit price from base price and factor", () => {
    // ৳45 (4500 poisha) * 5 (can of 5 liters) = 22500 poisha (৳225)
    expect(computeUnitDerivedPriceMinor(4500n, 5)).toBe(22500n);
    // ৳45 * 200 (drum) = 900000 poisha (৳9000)
    expect(computeUnitDerivedPriceMinor(4500n, 200)).toBe(900000n);
    // ৳120 (12000 poisha) * 25 (bag) = 300000 poisha (৳3000)
    expect(computeUnitDerivedPriceMinor(12000n, 25)).toBe(300000n);
  });

  it("formats stock with biggest unit breakdown", () => {
    const units = [
      { name: "5 লিটার ক্যান", factor: 5 },
      { name: "ড্রাম", factor: 200 },
    ];

    // 450 liters: "৪৫০ লিটার (২ ড্রাম ৫০ লিটার)"
    expect(formatStockWithBiggestUnit(450, "l", units, "bn")).toBe("৪৫০ লিটার (২ ড্রাম ৫০ লিটার)");

    // 400 liters: "৪০০ লিটার (২ ড্রাম)"
    expect(formatStockWithBiggestUnit(400, "l", units, "bn")).toBe("৪০০ লিটার (২ ড্রাম)");

    // 50 liters: "৫০ লিটার"
    expect(formatStockWithBiggestUnit(50, "l", units, "bn")).toBe("৫০ লিটার");

    // standard pcs: "১০ পিস"
    expect(formatStockWithBiggestUnit(10, "pcs", [], "bn")).toBe("১০ পিস");
  });
});
