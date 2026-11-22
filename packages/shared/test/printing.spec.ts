import { describe, it, expect } from "vitest";
import {
  ESCPOS_COMMANDS,
  ESCPOS_CONSTANTS,
  buildRasterCommand,
  hasCashPayment,
  encodeReceiptText,
  encodeReceiptEscPos,
  ReceiptModel,
  RasterBitmap,
} from "../src/printing.js";

describe("ESCPOS Thermal Receipt Printing Engine", () => {
  const sampleReceipt: ReceiptModel = {
    shopName: "Aarong Fashion Ltd",
    branchName: "Dhanmondi Branch",
    branchAddress: "House 12, Road 27, Dhaka 1209",
    invoiceNumber: "INV-20261122-0042",
    createdAt: "2026-11-22 18:30:00",
    cashierName: "Rahim Ahmed",
    registerName: "REG-01",
    customerName: "Tanvir Hossain",
    customerPhone: "01711000000",
    items: [
      {
        name: "Panjabi Silk Embroidery",
        sku: "PAN-SLK-01",
        size: "42",
        color: "Navy Blue",
        quantity: 1,
        unitPriceMinor: 350000,
        totalMinor: 350000,
      },
      {
        name: "Cotton Pajama White",
        sku: "PAJ-COT-02",
        size: "L",
        quantity: 2,
        unitPriceMinor: 80000,
        totalMinor: 160000,
      },
    ],
    grossMinor: 510000,
    discountMinor: 50000,
    taxMinor: 23000,
    totalMinor: 483000,
    paidMinor: 500000,
    changeMinor: 17000,
    dueMinor: 0,
    customerTotalDueMinor: 0,
    pointsEarned: 48,
    pointsRedeemed: 0,
    newPointsBalance: 320,
    payments: [
      {
        paymentMethod: "cash",
        amountMinor: 500000,
      },
    ],
    receiptHeader: "BIN: 001234567-0101 (Mushak 6.3)",
    receiptFooter: "Exchange within 7 days with invoice.",
  };

  describe("1. Exact Byte Headers", () => {
    it("matches standard ESC/POS INIT header (ESC @ = [0x1B, 0x40])", () => {
      expect(Array.from(ESCPOS_COMMANDS.INIT)).toEqual([0x1b, 0x40]);
    });

    it("matches standard ESC/POS FEED command (ESC d n = [0x1B, 0x64, n])", () => {
      expect(Array.from(ESCPOS_COMMANDS.FEED(3))).toEqual([0x1b, 0x64, 0x03]);
      expect(Array.from(ESCPOS_COMMANDS.FEED(4))).toEqual([0x1b, 0x64, 0x04]);
    });

    it("matches standard ESC/POS PARTIAL CUT command (GS V 1 = [0x1D, 0x56, 0x01])", () => {
      expect(Array.from(ESCPOS_COMMANDS.PARTIAL_CUT)).toEqual([0x1d, 0x56, 0x01]);
    });

    it("matches standard ESC/POS FULL CUT command (GS V 0 = [0x1D, 0x56, 0x00])", () => {
      expect(Array.from(ESCPOS_COMMANDS.FULL_CUT)).toEqual([0x1d, 0x56, 0x00]);
    });

    it("matches standard cash drawer kick bytes (ESC p 0 25 250 = [0x1B, 0x70, 0x00, 0x19, 0xFA])", () => {
      expect(Array.from(ESCPOS_COMMANDS.DRAWER_KICK)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    });
  });

  describe("2. Raster Width and Height Bytes for 80mm and 58mm", () => {
    it("encodes correct GS v 0 header for 80mm paper width (576 dots = 72 bytes wide)", () => {
      // 576 dots wide = 72 bytes per row -> xL = 72 (0x48), xH = 0 (0x00)
      const height = 100; // yL = 100 (0x64), yH = 0 (0x00)
      const bitmapData = new Uint8Array(72 * height).fill(0xaa);
      const bitmap: RasterBitmap = {
        width: ESCPOS_CONSTANTS.DOTS_80MM, // 576
        height,
        data: bitmapData,
      };

      const cmd = buildRasterCommand(bitmap);

      // Header is 8 bytes: GS v 0 m xL xH yL yH
      expect(Array.from(cmd.subarray(0, 8))).toEqual([
        0x1d, // GS
        0x76, // 'v'
        0x30, // '0'
        0x00, // mode 0 (normal)
        0x48, // xL = 72
        0x00, // xH = 0
        0x64, // yL = 100
        0x00, // yH = 0
      ]);

      expect(cmd.length).toBe(8 + 72 * 100);
      expect(cmd[8]).toBe(0xaa);
    });

    it("encodes correct GS v 0 header for 58mm paper width (384 dots = 48 bytes wide)", () => {
      // 384 dots wide = 48 bytes per row -> xL = 48 (0x30), xH = 0 (0x00)
      const height = 300; // yL = 300 & 0xFF = 44 (0x2C), yH = 300 >> 8 = 1 (0x01)
      const bitmapData = new Uint8Array(48 * height).fill(0x55);
      const bitmap: RasterBitmap = {
        width: ESCPOS_CONSTANTS.DOTS_58MM, // 384
        height,
        data: bitmapData,
      };

      const cmd = buildRasterCommand(bitmap);

      // Header: GS v 0 m xL xH yL yH
      expect(Array.from(cmd.subarray(0, 8))).toEqual([
        0x1d, // GS
        0x76, // 'v'
        0x30, // '0'
        0x00, // mode 0
        0x30, // xL = 48
        0x00, // xH = 0
        0x2c, // yL = 44 (300 % 256)
        0x01, // yH = 1 (300 / 256)
      ]);

      expect(cmd.length).toBe(8 + 48 * 300);
      expect(cmd[8]).toBe(0x55);
    });
  });

  describe("3. Drawer Kick Present or Absent by Payment Method", () => {
    it("includes drawer kick on cash sale", () => {
      expect(hasCashPayment(sampleReceipt)).toBe(true);

      const bitmap: RasterBitmap = {
        width: ESCPOS_CONSTANTS.DOTS_80MM,
        height: 10,
        data: new Uint8Array(72 * 10),
      };

      const output = encodeReceiptEscPos(sampleReceipt, {
        paperWidth: "80mm",
        mode: "raster",
        openCashDrawer: true,
      }, bitmap);

      // The last 5 bytes should be the drawer kick: [0x1B, 0x70, 0x00, 0x19, 0xFA]
      const last5 = Array.from(output.subarray(output.length - 5));
      expect(last5).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    });

    it("omits drawer kick on bKash-only sale", () => {
      const bkashReceipt: ReceiptModel = {
        ...sampleReceipt,
        payments: [
          {
            paymentMethod: "bkash",
            amountMinor: 483000,
            reference: "TRX998822",
          },
        ],
      };

      expect(hasCashPayment(bkashReceipt)).toBe(false);

      const bitmap: RasterBitmap = {
        width: ESCPOS_CONSTANTS.DOTS_80MM,
        height: 10,
        data: new Uint8Array(72 * 10),
      };

      const output = encodeReceiptEscPos(bkashReceipt, {
        paperWidth: "80mm",
        mode: "raster",
        openCashDrawer: true,
      }, bitmap);

      // Drawer kick should NOT be present anywhere in the stream
      const kickStr = Buffer.from(ESCPOS_COMMANDS.DRAWER_KICK).toString("hex");
      const outStr = Buffer.from(output).toString("hex");
      expect(outStr.includes(kickStr)).toBe(false);

      // The last 3 bytes should be the partial cut: [0x1D, 0x56, 0x01]
      const last3 = Array.from(output.subarray(output.length - 3));
      expect(last3).toEqual([0x1d, 0x56, 0x01]);
    });

    it("omits drawer kick on loyalty-points-only sale", () => {
      const pointsReceipt: ReceiptModel = {
        ...sampleReceipt,
        paidMinor: 0,
        payments: [
          {
            paymentMethod: "points",
            amountMinor: 483000,
          },
        ],
      };

      expect(hasCashPayment(pointsReceipt)).toBe(false);

      const output = encodeReceiptText(pointsReceipt, {
        paperWidth: "80mm",
        mode: "text",
        openCashDrawer: true,
      });

      const kickStr = Buffer.from(ESCPOS_COMMANDS.DRAWER_KICK).toString("hex");
      const outStr = Buffer.from(output).toString("hex");
      expect(outStr.includes(kickStr)).toBe(false);
    });

    it("includes drawer kick on split cash + bKash payment", () => {
      const splitReceipt: ReceiptModel = {
        ...sampleReceipt,
        payments: [
          { paymentMethod: "bkash", amountMinor: 200000 },
          { paymentMethod: "cash", amountMinor: 283000 },
        ],
      };

      expect(hasCashPayment(splitReceipt)).toBe(true);

      const output = encodeReceiptText(splitReceipt, {
        paperWidth: "80mm",
        mode: "text",
        openCashDrawer: true,
      });

      const last5 = Array.from(output.subarray(output.length - 5));
      expect(last5).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    });
  });

  describe("4. Golden-File Deterministic Comparison", () => {
    it("generates deterministic byte stream for fixed 80mm sample receipt in text mode", () => {
      const output = encodeReceiptText(sampleReceipt, {
        paperWidth: "80mm",
        mode: "text",
        openCashDrawer: true,
      });

      // Verify exact length and key byte indices
      expect(output.length).toBeGreaterThan(500);

      // Starts with ESC @
      expect(Array.from(output.subarray(0, 2))).toEqual([0x1b, 0x40]);

      // Contains shop name
      const fullText = Buffer.from(output).toString("utf8");
      expect(fullText).toContain("Aarong Fashion Ltd");
      expect(fullText).toContain("Dhanmondi Branch");
      expect(fullText).toContain("INV-20261122-0042");
      expect(fullText).toContain("Panjabi Silk Embroidery");
      expect(fullText).toContain("Cotton Pajama White");
      expect(fullText).toContain("TOTAL PAYABLE:");
      expect(fullText).toContain("TK 4,830.00");
      expect(fullText).toContain("Paid (CASH):");
      expect(fullText).toContain("Change Given:");
      expect(fullText).toContain("Points Balance:");

      // Ends with partial cut followed by drawer kick
      const endingBytes = Array.from(output.subarray(output.length - 8));
      // partial cut (3 bytes: 1D 56 01) + drawer kick (5 bytes: 1B 70 00 19 FA)
      expect(endingBytes).toEqual([
        0x1d, 0x56, 0x01,
        0x1b, 0x70, 0x00, 0x19, 0xfa,
      ]);
    });

    it("generates deterministic byte stream for fixed raster receipt", () => {
      const deterministicBitmap: RasterBitmap = {
        width: ESCPOS_CONSTANTS.DOTS_80MM, // 576
        height: 20,
        data: new Uint8Array(72 * 20),
      };
      // Fill pattern: alternate stripes
      for (let i = 0; i < deterministicBitmap.data.length; i++) {
        deterministicBitmap.data[i] = i % 2 === 0 ? 0xff : 0x00;
      }

      const output = encodeReceiptEscPos(sampleReceipt, {
        paperWidth: "80mm",
        mode: "raster",
        openCashDrawer: true,
      }, deterministicBitmap);

      // Structure:
      // 1. ESC @ (2 bytes)
      // 2. GS v 0 header (8 bytes)
      // 3. Raster data (72 * 20 = 1440 bytes)
      // 4. FEED 4 (3 bytes)
      // 5. PARTIAL CUT (3 bytes)
      // 6. DRAWER KICK (5 bytes)
      // Total expected length = 2 + 8 + 1440 + 3 + 3 + 5 = 1461 bytes
      expect(output.length).toBe(1461);

      expect(Array.from(output.subarray(0, 2))).toEqual([0x1b, 0x40]);
      expect(Array.from(output.subarray(2, 10))).toEqual([
        0x1d, 0x76, 0x30, 0x00, 0x48, 0x00, 0x14, 0x00,
      ]);
      expect(output[10]).toBe(0xff);
      expect(output[11]).toBe(0x00);
      expect(Array.from(output.subarray(output.length - 11))).toEqual([
        0x1b, 0x64, 0x04, // FEED 4
        0x1d, 0x56, 0x01, // PARTIAL CUT
        0x1b, 0x70, 0x00, 0x19, 0xfa, // DRAWER KICK
      ]);
    });
  });
});
