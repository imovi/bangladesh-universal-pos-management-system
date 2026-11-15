import { describe, it, expect } from "vitest";
import {
  calculateSaleTotals,
  roundHalfUp,
  parseQuantityThousandths,
  distributeBillDiscount,
  SaleLineItemInput,
  SaleCalculationOptions,
} from "@universal-pos/shared";

describe("M1: Shared Money and Tax Maths", () => {
  describe("roundHalfUp pure function", () => {
    it("correctly rounds half up for positive integer fractions", () => {
      expect(roundHalfUp(15n, 10n)).toBe(2n);
      expect(roundHalfUp(14n, 10n)).toBe(1n);
      expect(roundHalfUp(25n, 10n)).toBe(3n);
      expect(roundHalfUp(150n, 100n)).toBe(2n);
      expect(roundHalfUp(149n, 100n)).toBe(1n);
      expect(roundHalfUp(0n, 100n)).toBe(0n);
    });
  });

  describe("parseQuantityThousandths", () => {
    it("accurately converts string and number quantities to integer thousandths without float drift", () => {
      expect(parseQuantityThousandths(1)).toBe(1000n);
      expect(parseQuantityThousandths("1.5")).toBe(1500n);
      expect(parseQuantityThousandths("0.333")).toBe(333n);
      expect(parseQuantityThousandths("2.500")).toBe(2500n);
      expect(parseQuantityThousandths(0.125)).toBe(125n);
    });
  });

  describe("distributeBillDiscount (Largest Remainder Method)", () => {
    it("distributes bill discount exactly so the parts sum identically to the total discount", () => {
      const lines = [
        { lineNetMinor: 100n },
        { lineNetMinor: 200n },
        { lineNetMinor: 300n },
      ];
      // Total net = 600. Discount = 50.
      // Line 1: 5000/600 = 8 rem 200
      // Line 2: 10000/600 = 16 rem 400
      // Line 3: 15000/600 = 25 rem 0
      // Base sum = 49. Remainder highest for Line 2 -> gets +1
      const allocated = distributeBillDiscount(lines, 50n);
      expect(allocated).toEqual([8n, 17n, 25n]);
      expect(allocated.reduce((a, b) => a + b, 0n)).toBe(50n);
    });

    it("caps bill discount at total line net if discount exceeds subtotal", () => {
      const lines = [{ lineNetMinor: 100n }, { lineNetMinor: 150n }];
      const allocated = distributeBillDiscount(lines, 500n);
      expect(allocated.reduce((a, b) => a + b, 0n)).toBe(250n);
    });
  });

  describe("Table-driven sale calculations", () => {
    it("Case 1: Standard fashion items with 3-decimal quantity, percent discount, and exclusive 7.5% tax", () => {
      const lines: SaleLineItemInput[] = [
        {
          variantId: "v-panjabi",
          unitPriceMinor: 250000n, // 2,500.00 BDT
          quantity: 2,
          discount: { type: "percent", percentBp: 1000 }, // 10%
          taxRateBp: 750, // 7.5%
        },
        {
          variantId: "v-fabric",
          unitPriceMinor: 45000n, // 450.00 BDT per meter
          quantity: "2.500", // 2.5 meters
          taxRateBp: 750, // 7.5%
        },
      ];

      const options: SaleCalculationOptions = {
        pricesIncludeTax: false,
        billDiscount: { type: "fixed", amountMinor: 20000n }, // 200.00 BDT bill discount
      };

      const result = calculateSaleTotals(lines, options);

      // Line 1:
      // Gross: 250000 * 2 = 500000
      // Line discount: 500000 * 1000 / 10000 = 50000
      // Line net: 450000
      // Line 2:
      // Gross: 45000 * 2.5 = 112500
      // Line net: 112500
      // Total net before bill discount = 562500
      // Bill discount = 20000
      // Line 1 bill share: 450000 * 20000 / 562500 = 16000 rem 0
      // Line 2 bill share: 112500 * 20000 / 562500 = 4000 rem 0
      // Effective net line 1: 450000 - 16000 = 434000
      // Tax line 1 (7.5%): roundHalfUp(434000 * 750 / 10000) = 32550
      // Total line 1: 434000 + 32550 = 466550
      // Effective net line 2: 112500 - 4000 = 108500
      // Tax line 2 (7.5%): roundHalfUp(108500 * 750 / 10000) = 8138
      // Total line 2: 108500 + 8138 = 116638

      expect(result.grossMinor).toBe(612500n);
      expect(result.lineDiscountMinor).toBe(50000n);
      expect(result.billDiscountMinor).toBe(20000n);
      expect(result.totalDiscountMinor).toBe(70000n);
      expect(result.netMinor).toBe(542500n);
      expect(result.taxMinor).toBe(40688n); // 32550 + 8138
      expect(result.totalMinor).toBe(583188n); // 542500 + 40688

      // Line sum invariance
      const lineTotalSum = result.lines.reduce((acc, l) => acc + l.totalMinor, 0n);
      expect(lineTotalSum).toBe(result.totalMinor);
    });

    it("Case 2: Inclusive tax (prices_include_tax = true) with odd division percent discount", () => {
      const lines: SaleLineItemInput[] = [
        {
          variantId: "v-shirt",
          unitPriceMinor: 100000n, // 1,000.00 BDT incl. tax
          quantity: 1,
          discount: { type: "percent", percentBp: 3333 }, // 33.33% discount
          taxRateBp: 500, // 5% VAT inclusive
        },
      ];

      const options: SaleCalculationOptions = {
        pricesIncludeTax: true,
      };

      const result = calculateSaleTotals(lines, options);

      // Gross: 100000
      // Discount (33.33%): roundHalfUp(100000 * 3333 / 10000) = 33330
      // Effective Net: 100000 - 33330 = 66670 (tax inclusive)
      // Extracted tax at 5%: roundHalfUp(66670 * 500 / 10500) = 3175
      expect(result.grossMinor).toBe(100000n);
      expect(result.totalDiscountMinor).toBe(33330n);
      expect(result.netMinor).toBe(66670n);
      expect(result.taxMinor).toBe(3175n);
      expect(result.totalMinor).toBe(66670n); // In inclusive tax, customer pays 66670
    });

    it("Case 3: Mixed zero-tax lines and taxable lines", () => {
      const lines: SaleLineItemInput[] = [
        {
          variantId: "v-essential",
          unitPriceMinor: 50000n,
          quantity: 1,
          taxRateBp: 0, // Zero tax (0%)
        },
        {
          variantId: "v-luxury",
          unitPriceMinor: 100000n,
          quantity: 1,
          taxRateBp: 1500, // 15% VAT
        },
      ];

      const result = calculateSaleTotals(lines, { pricesIncludeTax: false });

      expect(result.lines[0].taxMinor).toBe(0n);
      expect(result.lines[1].taxMinor).toBe(15000n);
      expect(result.taxMinor).toBe(15000n);
      expect(result.totalMinor).toBe(165000n);
    });
  });

  describe("Property-based Test: Line Sum Invariance across 100 randomized baskets", () => {
    it("guarantees that sum of lines ALWAYS identically equals total calculation", () => {
      for (let i = 0; i < 100; i++) {
        const lineCount = 1 + (i % 8);
        const pricesIncludeTax = i % 2 === 0;

        const lines: SaleLineItemInput[] = [];
        for (let j = 0; j < lineCount; j++) {
          const unitPrice = 1000n + BigInt((j * 7919 + i * 31) % 500000);
          const qty = `${1 + (j % 5)}.${((j * 173) % 1000).toString().padStart(3, "0")}`;
          const hasDiscount = (i + j) % 3 === 0;
          const taxRateBp = ((j * 250) % 1500); // 0%, 2.5%, 5%, 7.5%, 10%, 12.5%

          lines.push({
            variantId: `var-${j}`,
            unitPriceMinor: unitPrice,
            quantity: qty,
            discount: hasDiscount
              ? { type: "percent", percentBp: 500 + ((j * 500) % 3000) }
              : undefined,
            taxRateBp,
          });
        }

        const billDiscountAmount = BigInt((i * 1234) % 10000);
        const result = calculateSaleTotals(lines, {
          pricesIncludeTax,
          billDiscount: { type: "fixed", amountMinor: billDiscountAmount },
        });

        // Invariants
        const sumGross = result.lines.reduce((acc, l) => acc + l.grossMinor, 0n);
        const sumLineDiscount = result.lines.reduce((acc, l) => acc + l.lineDiscountMinor, 0n);
        const sumAllocatedBillDiscount = result.lines.reduce((acc, l) => acc + l.allocatedBillDiscountMinor, 0n);
        const sumEffectiveNet = result.lines.reduce((acc, l) => acc + l.effectiveLineNetMinor, 0n);
        const sumTax = result.lines.reduce((acc, l) => acc + l.taxMinor, 0n);
        const sumTotal = result.lines.reduce((acc, l) => acc + l.totalMinor, 0n);

        expect(sumGross).toBe(result.grossMinor);
        expect(sumLineDiscount).toBe(result.lineDiscountMinor);
        expect(sumAllocatedBillDiscount).toBe(result.billDiscountMinor);
        expect(sumEffectiveNet).toBe(result.netMinor);
        expect(sumTax).toBe(result.taxMinor);
        expect(sumTotal).toBe(result.totalMinor);
      }
    });
  });
});
