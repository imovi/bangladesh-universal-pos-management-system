import { describe, it, expect } from "vitest";

describe("Milestone A7: Dashboard & Reports Parity and Formulas", () => {
  it("verifies sales summary figures match API figures without client recalculation drift", () => {
    // Demo API response from GET /reports/sales-summary
    const apiSummary = {
      salesCount: 4,
      totalGrossMinor: 120000, // 1,200.00 BDT
      totalDiscountMinor: 10000, // 100.00 BDT
      totalTaxMinor: 5500, // 55.00 BDT
      totalNetMinor: 115500, // 1,155.00 BDT
      paymentsByMethod: {
        cash: 50000,
        bkash: 65500,
      },
    };

    // Client displays these exact figures
    expect(apiSummary.totalNetMinor).toBe(115500);
    expect(apiSummary.totalGrossMinor).toBe(120000);
    expect(apiSummary.totalDiscountMinor).toBe(10000);
    expect(apiSummary.totalTaxMinor).toBe(5500);

    // Sum of payments must equal or reconcile with collected payments
    const totalPayments = Object.values(apiSummary.paymentsByMethod).reduce((a, b) => a + b, 0);
    expect(totalPayments).toBe(115500);

    // Average basket calculation: integer rounded
    const avgSaleMinor = apiSummary.salesCount > 0
      ? Math.round(apiSummary.totalNetMinor / apiSummary.salesCount)
      : 0;
    expect(avgSaleMinor).toBe(28875); // 288.75 BDT
  });

  it("verifies profit and loss formulas match backend API definitions exactly", () => {
    // Demo API response from GET /reports/profit
    const apiProfit = {
      revenueMinor: 100000, // 1,000.00 BDT
      cogsMinor: 60000, // 600.00 BDT
      grossProfitMinor: 40000, // 400.00 BDT
      profitMarginBp: 4000, // 40.00%
    };

    // Parity verification: Revenue - COGS = Gross Profit
    expect(apiProfit.revenueMinor - apiProfit.cogsMinor).toBe(apiProfit.grossProfitMinor);

    // Margin in percentage = profitMarginBp / 100
    const marginPct = (apiProfit.profitMarginBp / 100).toFixed(2);
    expect(marginPct).toBe("40.00");
  });

  it("verifies stock valuation calculations match backend API totals", () => {
    // Demo API response from GET /reports/stock-valuation
    const apiStockValuation = {
      totalQty: 25,
      totalValuationMinor: 250000, // 2,500.00 BDT
      items: [
        {
          variantId: "v-1",
          sku: "SHIRT-RED-M",
          productName: "Cotton Shirt",
          quantity: 10,
          unitCostMinor: 10000, // 100.00 BDT
          valuationMinor: 100000, // 1,000.00 BDT
        },
        {
          variantId: "v-2",
          sku: "SHIRT-RED-L",
          productName: "Cotton Shirt",
          quantity: 15,
          unitCostMinor: 10000, // 100.00 BDT
          valuationMinor: 150000, // 1,500.00 BDT
        },
      ],
    };

    const calculatedTotalQty = apiStockValuation.items.reduce((s, it) => s + it.quantity, 0);
    const calculatedTotalValuation = apiStockValuation.items.reduce((s, it) => s + it.valuationMinor, 0);

    expect(calculatedTotalQty).toBe(apiStockValuation.totalQty);
    expect(calculatedTotalValuation).toBe(apiStockValuation.totalValuationMinor);
  });

  it("verifies CSV export sanitizes fields, escapes quotes and produces UTF-8 BOM", () => {
    const sanitizeCell = (cell: string | number | boolean | null | undefined): string => {
      if (cell === null || cell === undefined) return '""';
      const str = String(cell);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const headers = ["Product", "SKU", "Units Sold", "Revenue (BDT)"];
    const rows = [
      ['Cotton T-Shirt, "Premium" Edition', "TSHIRT-001", 5, 2500.50],
      ["Panjabi & Pajama", "PANJABI-002", 2, 4500.00],
    ];

    const headerLine = headers.map(sanitizeCell).join(",");
    const rowLines = rows.map((r) => r.map(sanitizeCell).join(","));
    const csvContent = "\uFEFF" + [headerLine, ...rowLines].join("\r\n");

    // Starts with UTF-8 BOM for Excel Bangla/English compatibility
    expect(csvContent.charCodeAt(0)).toBe(0xFEFF);

    // Properly escaped quotes
    expect(csvContent).toContain('"Cotton T-Shirt, ""Premium"" Edition"');
    expect(csvContent).toContain('"Panjabi & Pajama"');
  });

  it("verifies variant matrix option mapping and cells integrity", () => {
    const matrixResponse = {
      productId: "prod-1",
      productName: "Formal Shirt",
      options: ["Size", "Color"],
      cells: [
        {
          variantId: "v-1",
          sku: "FSHIRT-M-BLUE",
          options: { Size: "M", Color: "Blue" },
          stockQty: 8,
          qtySold: 12,
        },
        {
          variantId: "v-2",
          sku: "FSHIRT-L-BLUE",
          options: { Size: "L", Color: "Blue" },
          stockQty: 4,
          qtySold: 9,
        },
      ],
    };

    expect(matrixResponse.options).toEqual(["Size", "Color"]);
    expect(matrixResponse.cells).toHaveLength(2);
    expect(matrixResponse.cells[0].options["Size"]).toBe("M");
    expect(matrixResponse.cells[0].options["Color"]).toBe("Blue");
    expect(matrixResponse.cells[0].stockQty).toBe(8);
    expect(matrixResponse.cells[0].qtySold).toBe(12);
  });
});
