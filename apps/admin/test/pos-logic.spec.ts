import { describe, it, expect } from "vitest";
import {
  calculateSaleTotals,
  calculateShiftCashTotals,
  parseQuantityThousandths,
} from "@universal-pos/shared";
import {
  computeCartTotals,
  calculatePaymentChange,
  matchBarcodeOrSku,
  CartItem,
} from "@/lib/pos/cart-calculations";

describe("POS Core Calculations & Cart Engine", () => {
  const dummyVariant1 = {
    id: "01933000-0000-7000-8000-000000000001",
    productId: "prod-1",
    productName: "Classic Oxford Shirt",
    sku: "OXF-BLU-M",
    size: "M",
    color: "Blue",
    priceMinor: 150000, // ৳1500.00
    taxRateBp: 500, // 5%
    barcodes: [{ barcode: "8901234567890" }],
  };

  const dummyVariant2 = {
    id: "01933000-0000-7000-8000-000000000002",
    productId: "prod-2",
    productName: "Chino Pants",
    sku: "CHN-BEI-32",
    size: "32",
    color: "Beige",
    priceMinor: 220000, // ৳2200.00
    taxRateBp: 750, // 7.5%
    barcodes: [{ barcode: "8901234567891" }],
  };

  it("calculates cart totals exactly matching calculateSaleTotals in tax-inclusive mode", () => {
    const items: CartItem[] = [
      {
        variantId: dummyVariant1.id,
        productId: dummyVariant1.productId,
        name: dummyVariant1.productName,
        sku: dummyVariant1.sku,
        size: dummyVariant1.size,
        color: dummyVariant1.color,
        unitPriceMinor: dummyVariant1.priceMinor,
        quantity: 2,
        taxRateBp: dummyVariant1.taxRateBp,
        discount: { type: "percent", percentBp: 1000 }, // 10% line discount
      },
      {
        variantId: dummyVariant2.id,
        productId: dummyVariant2.productId,
        name: dummyVariant2.productName,
        sku: dummyVariant2.sku,
        size: dummyVariant2.size,
        color: dummyVariant2.color,
        unitPriceMinor: dummyVariant2.priceMinor,
        quantity: 1,
        taxRateBp: dummyVariant2.taxRateBp,
      },
    ];

    const billDiscount = { type: "fixed" as const, amountMinor: 20000 }; // ৳200 fixed bill discount
    const pricesIncludeTax = true;

    const cartTotals = computeCartTotals(items, { pricesIncludeTax, billDiscount });

    // Direct recomputation with @universal-pos/shared calculateSaleTotals
    const referenceTotals = calculateSaleTotals(
      items.map((it) => ({
        variantId: it.variantId,
        unitPriceMinor: it.unitPriceMinor,
        quantity: it.quantity,
        taxRateBp: it.taxRateBp,
        discount: it.discount,
      })),
      { pricesIncludeTax, billDiscount },
    );

    expect(cartTotals.grossMinor).toBe(Number(referenceTotals.grossMinor));
    expect(cartTotals.totalDiscountMinor).toBe(Number(referenceTotals.totalDiscountMinor));
    expect(cartTotals.taxMinor).toBe(Number(referenceTotals.taxMinor));
    expect(cartTotals.totalMinor).toBe(Number(referenceTotals.totalMinor));
    expect(cartTotals.expectedTotalMinor).toBe(Number(referenceTotals.totalMinor));
  });

  it("calculates cart totals exactly matching calculateSaleTotals in tax-exclusive mode", () => {
    const items: CartItem[] = [
      {
        variantId: dummyVariant1.id,
        productId: dummyVariant1.productId,
        name: dummyVariant1.productName,
        sku: dummyVariant1.sku,
        size: dummyVariant1.size,
        color: dummyVariant1.color,
        unitPriceMinor: dummyVariant1.priceMinor,
        quantity: 1,
        taxRateBp: 500,
      },
    ];

    const pricesIncludeTax = false;
    const cartTotals = computeCartTotals(items, { pricesIncludeTax });

    const referenceTotals = calculateSaleTotals(
      items.map((it) => ({
        variantId: it.variantId,
        unitPriceMinor: it.unitPriceMinor,
        quantity: it.quantity,
        taxRateBp: it.taxRateBp,
      })),
      { pricesIncludeTax },
    );

    expect(cartTotals.totalMinor).toBe(Number(referenceTotals.totalMinor));
    expect(cartTotals.taxMinor).toBe(Number(referenceTotals.taxMinor));
    expect(cartTotals.totalMinor).toBe(150000 + Number(referenceTotals.taxMinor));
  });

  describe("Change & Split Payment Calculation", () => {
    it("handles exact cash payment with 0 change", () => {
      const res = calculatePaymentChange(150000, [
        { paymentMethod: "cash", amountMinor: 150000 },
      ]);
      expect(res.isCovered).toBe(true);
      expect(res.changeDueMinor).toBe(0);
      expect(res.balanceDueMinor).toBe(0);
    });

    it("handles cash overpayment with correct change", () => {
      const res = calculatePaymentChange(150000, [
        { paymentMethod: "cash", amountMinor: 200000 },
      ]);
      expect(res.isCovered).toBe(true);
      expect(res.changeDueMinor).toBe(50000); // ৳500 change
      expect(res.balanceDueMinor).toBe(0);
    });

    it("handles split payment (bKash + Cash) giving change only against cash", () => {
      const totalMinor = 250000; // ৳2500
      const payments = [
        { paymentMethod: "bkash" as const, amountMinor: 100000, reference: "TRX-123" }, // ৳1000
        { paymentMethod: "cash" as const, amountMinor: 200000 }, // ৳2000 cash given
      ];
      const res = calculatePaymentChange(totalMinor, payments);
      expect(res.isCovered).toBe(true);
      expect(res.totalPaidMinor).toBe(300000);
      expect(res.changeDueMinor).toBe(50000); // ৳500 change
      expect(res.balanceDueMinor).toBe(0);
      expect(res.isValid).toBe(true);
    });

    it("rejects non-cash overpayment where non-cash exceeds total", () => {
      const totalMinor = 100000;
      const payments = [
        { paymentMethod: "bkash" as const, amountMinor: 120000, reference: "TRX-999" },
      ];
      const res = calculatePaymentChange(totalMinor, payments);
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toBeDefined();
    });

    it("identifies underpaid payments accurately", () => {
      const totalMinor = 150000;
      const payments = [
        { paymentMethod: "card" as const, amountMinor: 100000 },
      ];
      const res = calculatePaymentChange(totalMinor, payments);
      expect(res.isCovered).toBe(false);
      expect(res.balanceDueMinor).toBe(50000);
      expect(res.changeDueMinor).toBe(0);
    });
  });

  describe("Barcode & SKU Matching", () => {
    const products = [
      {
        id: "prod-1",
        name: "Classic Oxford Shirt",
        variants: [
          {
            id: dummyVariant1.id,
            sku: dummyVariant1.sku,
            priceMinor: dummyVariant1.priceMinor,
            taxRateBp: dummyVariant1.taxRateBp,
            barcodes: [{ barcode: "8901234567890" }],
            optionValues: [
              { optionValue: { option: { name: "Size" }, value: "M" } },
              { optionValue: { option: { name: "Color" }, value: "Blue" } },
            ],
            stockLevels: [{ branchId: "b-1", quantity: 15 }],
          },
        ],
      },
    ];

    it("matches exact barcode and extracts product and variant details", () => {
      const result = matchBarcodeOrSku("8901234567890", products, "b-1");
      expect(result.matched).toBe(true);
      expect(result.variant?.id).toBe(dummyVariant1.id);
      expect(result.product?.name).toBe("Classic Oxford Shirt");
    });

    it("matches exact SKU case-insensitively", () => {
      const result = matchBarcodeOrSku("oxf-blu-m", products, "b-1");
      expect(result.matched).toBe(true);
      expect(result.variant?.id).toBe(dummyVariant1.id);
    });

    it("returns matched: false for unknown barcode", () => {
      const result = matchBarcodeOrSku("9999999999999", products, "b-1");
      expect(result.matched).toBe(false);
      expect(result.variant).toBeUndefined();
    });
  });

  describe("Shift Cash Calculation Validation", () => {
    it("matches expected cash formula: opening + cash sales - change - cash out + cash in", () => {
      const result = calculateShiftCashTotals({
        openingCashMinor: 100000n, // ৳1,000 opening
        cashMovements: [
          { type: "cash_in", amountMinor: 50000n }, // ৳500 in
          { type: "cash_out", amountMinor: 30000n }, // ৳300 out
        ],
        sales: [
          {
            status: "completed",
            changeMinor: 20000n, // ৳200 change given
            payments: [
              { paymentMethod: "cash", amountMinor: 150000n }, // ৳1500 cash paid
              { paymentMethod: "bkash", amountMinor: 50000n }, // ৳500 bKash
            ],
          },
        ],
      });

      // expected = 1000 + (1500 - 200) - 300 + 500 = 2500 -> 250000 minor
      expect(result.expectedCashMinor).toBe(250000n);
      expect(result.netCashSalesMinor).toBe(130000n);
      expect(result.paymentMethodTotalsMinor.cash).toBe(150000n);
      expect(result.paymentMethodTotalsMinor.bkash).toBe(50000n);
    });
  });
});
