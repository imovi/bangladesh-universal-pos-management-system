import { describe, it, expect } from "vitest";
import {
  calculateSaleTotals,
  calculateLineReturnRefund,
  parseQuantityThousandths,
} from "@universal-pos/shared";

describe("Milestone C1: Exact Poisha Return Rounding Engine", () => {
  it("calculates exact poisha refunds where the sum of all partial returns equals the sale total exactly", () => {
    // 1. Set up a sale with:
    // - Line 1: 3 units @ ৳150.00 (15000 poisha), 10% line discount, 5% tax (500 bp)
    // - Line 2: 2 units @ ৳300.00 (30000 poisha), fixed ৳50 line discount (5000 poisha), 15% tax (1500 bp)
    // - Bill discount: ৳75.00 (7500 poisha)
    const lineInputs = [
      {
        lineId: "line-1",
        variantId: "01a1e49a-432b-7101-9945-5d6012ef4501",
        unitPriceMinor: 15000,
        quantity: 3,
        discount: { type: "percent" as const, percentBp: 1000 },
        taxRateBp: 500,
      },
      {
        lineId: "line-2",
        variantId: "01a1e49a-432b-7101-9945-5d6012ef4502",
        unitPriceMinor: 30000,
        quantity: 2,
        discount: { type: "fixed" as const, amountMinor: 5000 },
        taxRateBp: 1500,
      },
    ];

    const saleCalc = calculateSaleTotals(lineInputs, {
      pricesIncludeTax: false,
      billDiscount: { type: "fixed", amountMinor: 7500 },
    });

    const line1 = saleCalc.lines[0];
    const line2 = saleCalc.lines[1];

    expect(saleCalc.totalMinor).toBe(line1.totalMinor + line2.totalMinor);
    expect(saleCalc.taxMinor).toBe(line1.taxMinor + line2.taxMinor);

    // 2. Partial return simulations on Line 1 (soldQty = 3 units):
    // Sequence A: Return 1 unit, then 1 unit, then 1 unit
    const soldQty1 = parseQuantityThousandths(3);
    const unitQty = parseQuantityThousandths(1);

    // Return 1st unit
    const ret1_1 = calculateLineReturnRefund(
      soldQty1,
      line1.totalMinor,
      line1.taxMinor,
      0n,
      0n,
      0n,
      unitQty,
    );
    expect(ret1_1.refundMinor).toBeGreaterThan(0n);

    // Return 2nd unit
    const ret1_2 = calculateLineReturnRefund(
      soldQty1,
      line1.totalMinor,
      line1.taxMinor,
      unitQty,
      ret1_1.refundMinor,
      ret1_1.taxRefundMinor,
      unitQty,
    );
    expect(ret1_2.refundMinor).toBeGreaterThan(0n);

    // Return 3rd unit (final unit of line 1)
    const ret1_3 = calculateLineReturnRefund(
      soldQty1,
      line1.totalMinor,
      line1.taxMinor,
      unitQty * 2n,
      ret1_1.refundMinor + ret1_2.refundMinor,
      ret1_1.taxRefundMinor + ret1_2.taxRefundMinor,
      unitQty,
    );

    // Strict assertion: sum of partial returns on Line 1 must equal line1.totalMinor
    const sumLine1Refund = ret1_1.refundMinor + ret1_2.refundMinor + ret1_3.refundMinor;
    const sumLine1Tax = ret1_1.taxRefundMinor + ret1_2.taxRefundMinor + ret1_3.taxRefundMinor;
    expect(sumLine1Refund).toBe(line1.totalMinor);
    expect(sumLine1Tax).toBe(line1.taxMinor);

    // 3. Partial return simulations on Line 2 (soldQty = 2 units):
    // Return 1 unit, then 1 unit
    const soldQty2 = parseQuantityThousandths(2);

    const ret2_1 = calculateLineReturnRefund(
      soldQty2,
      line2.totalMinor,
      line2.taxMinor,
      0n,
      0n,
      0n,
      unitQty,
    );

    const ret2_2 = calculateLineReturnRefund(
      soldQty2,
      line2.totalMinor,
      line2.taxMinor,
      unitQty,
      ret2_1.refundMinor,
      ret2_1.taxRefundMinor,
      unitQty,
    );

    // Strict assertion: sum of partial returns on Line 2 must equal line2.totalMinor
    const sumLine2Refund = ret2_1.refundMinor + ret2_2.refundMinor;
    const sumLine2Tax = ret2_1.taxRefundMinor + ret2_2.taxRefundMinor;
    expect(sumLine2Refund).toBe(line2.totalMinor);
    expect(sumLine2Tax).toBe(line2.taxMinor);

    // 4. Overarching invariant: sum of all possible returns equals the sale total exactly to the poisha
    const totalReturnedMinor = sumLine1Refund + sumLine2Refund;
    const totalReturnedTax = sumLine1Tax + sumLine2Tax;
    expect(totalReturnedMinor).toBe(saleCalc.totalMinor);
    expect(totalReturnedTax).toBe(saleCalc.taxMinor);

    // 5. Sequence B: Return 2 units then 1 unit on Line 1
    const ret1_batch1 = calculateLineReturnRefund(
      soldQty1,
      line1.totalMinor,
      line1.taxMinor,
      0n,
      0n,
      0n,
      parseQuantityThousandths(2),
    );
    const ret1_batch2 = calculateLineReturnRefund(
      soldQty1,
      line1.totalMinor,
      line1.taxMinor,
      parseQuantityThousandths(2),
      ret1_batch1.refundMinor,
      ret1_batch1.taxRefundMinor,
      parseQuantityThousandths(1),
    );
    expect(ret1_batch1.refundMinor + ret1_batch2.refundMinor).toBe(line1.totalMinor);

    // 6. Over-return prevention
    expect(() => {
      calculateLineReturnRefund(
        soldQty1,
        line1.totalMinor,
        line1.taxMinor,
        soldQty1, // already returned all 3 units
        line1.totalMinor,
        line1.taxMinor,
        unitQty, // attempting to return 1 more
      );
    }).toThrow(/Cannot return more than sold quantity/);
  });
});
