/**
 * ESC/POS Thermal Receipt Printing Engine
 * Supports 80mm (576 dots / 48 columns) and 58mm (384 dots / 32 columns).
 * Provides 1-bit raster graphics (GS v 0) for crisp Bangla/multi-language printing,
 * text mode for high-speed English printing, and conditional cash drawer kick.
 */

export interface ReceiptItem {
  name: string;
  sku?: string;
  size?: string;
  color?: string;
  unitName?: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  discountMinor?: number;
}

export interface ReceiptPayment {
  paymentMethod: string;
  amountMinor: number;
  reference?: string;
}

export interface ReceiptModel {
  shopName: string;
  branchName?: string;
  branchAddress?: string;
  invoiceNumber: string;
  createdAt: string;
  cashierName?: string;
  registerName?: string;
  customerName?: string;
  customerPhone?: string;
  items: ReceiptItem[];
  grossMinor: number;
  discountMinor?: number;
  taxMinor?: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  dueMinor?: number;
  customerTotalDueMinor?: number;
  pointsEarned?: number;
  pointsRedeemed?: number;
  newPointsBalance?: number;
  payments: ReceiptPayment[];
  receiptHeader?: string;
  receiptFooter?: string;
}

export type PaperWidth = "80mm" | "58mm";
export type PrintMode = "raster" | "text";

export interface PrinterSettings {
  paperWidth: PaperWidth;
  mode?: PrintMode;
  copies?: number;
  openCashDrawer?: boolean;
}

export interface RasterBitmap {
  width: number; // 576 for 80mm, 384 for 58mm
  height: number;
  data: Uint8Array; // 1-bit packed bitmap data: (width / 8) * height bytes
}

export const ESCPOS_CONSTANTS = {
  DOTS_80MM: 576,
  DOTS_58MM: 384,
  CHARS_80MM: 48,
  CHARS_58MM: 32,
};

export const ESCPOS_COMMANDS = {
  INIT: new Uint8Array([0x1b, 0x40]), // ESC @
  FEED: (lines = 3) => new Uint8Array([0x1b, 0x64, Math.max(1, Math.min(255, lines))]), // ESC d n
  PARTIAL_CUT: new Uint8Array([0x1d, 0x56, 0x01]), // GS V 1
  FULL_CUT: new Uint8Array([0x1d, 0x56, 0x00]), // GS V 0
  DRAWER_KICK: new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]), // ESC p 0 25 250 (Pin 2, 50ms ON, 500ms OFF)
  ALIGN_LEFT: new Uint8Array([0x1b, 0x61, 0x00]), // ESC a 0
  ALIGN_CENTER: new Uint8Array([0x1b, 0x61, 0x01]), // ESC a 1
  ALIGN_RIGHT: new Uint8Array([0x1b, 0x61, 0x02]), // ESC a 2
  BOLD_ON: new Uint8Array([0x1b, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: new Uint8Array([0x1b, 0x45, 0x00]), // ESC E 0
  DOUBLE_HEIGHT_ON: new Uint8Array([0x1d, 0x21, 0x01]), // GS ! 1
  DOUBLE_WIDTH_ON: new Uint8Array([0x1d, 0x21, 0x10]), // GS ! 16
  DOUBLE_SIZE_ON: new Uint8Array([0x1d, 0x21, 0x11]), // GS ! 17
  NORMAL_SIZE: new Uint8Array([0x1d, 0x21, 0x00]), // GS ! 0
};

/**
 * Checks whether a sale includes a cash payment component.
 */
export function hasCashPayment(receipt: ReceiptModel): boolean {
  if (receipt.payments && receipt.payments.length > 0) {
    return receipt.payments.some(
      (p) => p.paymentMethod && p.paymentMethod.toLowerCase() === "cash" && p.amountMinor > 0
    );
  }
  return receipt.paidMinor > 0;
}

/**
 * Encodes a 1-bit monochrome bitmap into an ESC/POS raster bit image command (GS v 0).
 * Command structure: [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...bitmapBytes]
 */
export function buildRasterCommand(bitmap: RasterBitmap): Uint8Array {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const xL = bytesPerRow & 0xff;
  const xH = (bytesPerRow >> 8) & 0xff;
  const yL = bitmap.height & 0xff;
  const yH = (bitmap.height >> 8) & 0xff;

  const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const expectedBytes = bytesPerRow * bitmap.height;
  const dataLength = Math.min(bitmap.data.length, expectedBytes);

  const result = new Uint8Array(header.length + expectedBytes);
  result.set(header, 0);
  result.set(bitmap.data.subarray(0, dataLength), header.length);

  return result;
}

/**
 * Formats a currency amount from minor units (poisha) to major units (taka).
 */
function formatTaka(minor: number): string {
  const isNegative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${isNegative ? "-" : ""}${major.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Pads or spaces two columns across a line width.
 */
function formatTwoColumns(left: string, right: string, width: number): string {
  const maxLeft = width - right.length - 1;
  const trimmedLeft = left.length > maxLeft ? left.slice(0, Math.max(0, maxLeft)) : left;
  const spaces = Math.max(1, width - trimmedLeft.length - right.length);
  return trimmedLeft + " ".repeat(spaces) + right + "\n";
}

/**
 * Generates plain text ESC/POS byte sequence for English-only receipts.
 */
export function encodeReceiptText(
  receipt: ReceiptModel,
  settings: PrinterSettings
): Uint8Array {
  const width = settings.paperWidth === "58mm" ? ESCPOS_CONSTANTS.CHARS_58MM : ESCPOS_CONSTANTS.CHARS_80MM;
  const divider = "-".repeat(width) + "\n";
  const doubleDivider = "=".repeat(width) + "\n";

  const chunks: Uint8Array[] = [];
  const textEncoder = new TextEncoder();

  const addText = (str: string) => chunks.push(textEncoder.encode(str));
  const addCmd = (cmd: Uint8Array) => chunks.push(cmd);

  // Initialize printer
  addCmd(ESCPOS_COMMANDS.INIT);

  // Header: Center aligned, Shop Name Double Size
  addCmd(ESCPOS_COMMANDS.ALIGN_CENTER);
  addCmd(ESCPOS_COMMANDS.BOLD_ON);
  addCmd(ESCPOS_COMMANDS.DOUBLE_SIZE_ON);
  addText(receipt.shopName + "\n");
  addCmd(ESCPOS_COMMANDS.NORMAL_SIZE);

  if (receipt.branchName) {
    addText(receipt.branchName + "\n");
  }
  if (receipt.branchAddress) {
    addText(receipt.branchAddress + "\n");
  }
  if (receipt.receiptHeader) {
    addText(receipt.receiptHeader + "\n");
  }

  addCmd(ESCPOS_COMMANDS.BOLD_OFF);
  addCmd(ESCPOS_COMMANDS.ALIGN_LEFT);
  addText(divider);

  // Metadata
  addText(formatTwoColumns("Invoice: " + receipt.invoiceNumber, receipt.createdAt, width));
  if (receipt.cashierName || receipt.registerName) {
    const cashierStr = `Cashier: ${receipt.cashierName || "-"}`;
    const regStr = `Reg: ${receipt.registerName || "-"}`;
    addText(formatTwoColumns(cashierStr, regStr, width));
  }
  if (receipt.customerName || receipt.customerPhone) {
    const custStr = `Cust: ${receipt.customerName || "Walk-in"}`;
    const phoneStr = receipt.customerPhone || "";
    addText(formatTwoColumns(custStr, phoneStr, width));
  }

  addText(divider);

  // Table header
  if (settings.paperWidth === "58mm") {
    // 32 chars: Item (16) Qty(4) Price(12)
    addText(formatTwoColumns("Item x Qty", "Total", width));
  } else {
    // 48 chars
    addText(formatTwoColumns("Item Description", "Qty   Rate    Total", width));
  }
  addText(divider);

  // Items
  for (const item of receipt.items) {
    const nameLine = item.name + (item.size ? ` (${item.size})` : "");
    const showUnit = item.unitName && item.unitName.toLowerCase() !== "pcs" && item.unitName !== "পিস";
    const unitSuffix = showUnit ? ` ${item.unitName}` : "";
    const qtyRateTotal = `${item.quantity}${unitSuffix} x ${formatTaka(item.unitPriceMinor)}   ${formatTaka(item.totalMinor)}`;

    if (settings.paperWidth === "58mm") {
      addText(nameLine + "\n");
      addText(formatTwoColumns(`  ${item.quantity}${unitSuffix} x ${formatTaka(item.unitPriceMinor)}`, formatTaka(item.totalMinor), width));
    } else {
      if (nameLine.length > 24) {
        addText(nameLine + "\n");
        addText(formatTwoColumns("  " + (item.sku || ""), qtyRateTotal, width));
      } else {
        addText(formatTwoColumns(nameLine, qtyRateTotal, width));
      }
    }
  }

  addText(divider);

  // Financial totals
  addText(formatTwoColumns("Subtotal:", formatTaka(receipt.grossMinor), width));
  if (receipt.discountMinor && receipt.discountMinor > 0) {
    addText(formatTwoColumns("Discount:", "-" + formatTaka(receipt.discountMinor), width));
  }
  if (receipt.taxMinor && receipt.taxMinor > 0) {
    addText(formatTwoColumns("VAT / Tax:", formatTaka(receipt.taxMinor), width));
  }

  addText(doubleDivider);
  addCmd(ESCPOS_COMMANDS.BOLD_ON);
  addText(formatTwoColumns("TOTAL PAYABLE:", "TK " + formatTaka(receipt.totalMinor), width));
  addCmd(ESCPOS_COMMANDS.BOLD_OFF);
  addText(divider);

  // Payments
  if (receipt.payments && receipt.payments.length > 0) {
    for (const p of receipt.payments) {
      const label = `Paid (${p.paymentMethod.toUpperCase()}):`;
      addText(formatTwoColumns(label, formatTaka(p.amountMinor), width));
    }
  } else {
    addText(formatTwoColumns("Paid Amount:", formatTaka(receipt.paidMinor), width));
  }

  if (receipt.changeMinor > 0) {
    addText(formatTwoColumns("Change Given:", formatTaka(receipt.changeMinor), width));
  }
  if (receipt.dueMinor && receipt.dueMinor > 0) {
    addCmd(ESCPOS_COMMANDS.BOLD_ON);
    addText(formatTwoColumns("Current Sale Due:", formatTaka(receipt.dueMinor), width));
    addCmd(ESCPOS_COMMANDS.BOLD_OFF);
  }
  if (receipt.customerTotalDueMinor && receipt.customerTotalDueMinor > 0) {
    addText(formatTwoColumns("Total Balance Due:", formatTaka(receipt.customerTotalDueMinor), width));
  }

  // Loyalty info
  if (receipt.pointsEarned || receipt.pointsRedeemed || receipt.newPointsBalance !== undefined) {
    addText(divider);
    if (receipt.pointsEarned) addText(formatTwoColumns("Points Earned:", `+${receipt.pointsEarned}`, width));
    if (receipt.pointsRedeemed) addText(formatTwoColumns("Points Redeemed:", `-${receipt.pointsRedeemed}`, width));
    if (receipt.newPointsBalance !== undefined) addText(formatTwoColumns("Points Balance:", `${receipt.newPointsBalance}`, width));
  }

  // Footer
  if (receipt.receiptFooter) {
    addText(divider);
    addCmd(ESCPOS_COMMANDS.ALIGN_CENTER);
    addText(receipt.receiptFooter + "\n");
  }

  addCmd(ESCPOS_COMMANDS.ALIGN_CENTER);
  addText("Thank You! Please Visit Again.\n");

  // Feed & Cut
  addCmd(ESCPOS_COMMANDS.FEED(4));
  addCmd(ESCPOS_COMMANDS.PARTIAL_CUT);

  // Drawer Kick (if cash payment was involved)
  if (settings.openCashDrawer !== false && hasCashPayment(receipt)) {
    addCmd(ESCPOS_COMMANDS.DRAWER_KICK);
  }

  // Combine into single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

/**
 * Pure function encoder for ESC/POS receipt generation.
 * In raster mode, outputs ESC @, the GS v 0 raster command, feed, partial cut, and cash drawer kick.
 * In text mode, outputs English text layout with feed, partial cut, and cash drawer kick.
 */
export function encodeReceiptEscPos(
  receipt: ReceiptModel,
  settings: PrinterSettings,
  bitmap?: RasterBitmap
): Uint8Array {
  // If text mode requested or no bitmap provided in raster mode, generate text mode
  if (settings.mode === "text" || !bitmap) {
    return encodeReceiptText(receipt, settings);
  }

  const chunks: Uint8Array[] = [];

  // 1. Initialize printer
  chunks.push(ESCPOS_COMMANDS.INIT);

  // 2. Raster bitmap image (GS v 0)
  chunks.push(buildRasterCommand(bitmap));

  // 3. Feed paper
  chunks.push(ESCPOS_COMMANDS.FEED(4));

  // 4. Partial cut
  chunks.push(ESCPOS_COMMANDS.PARTIAL_CUT);

  // 5. Drawer kick (only if cash payment)
  if (settings.openCashDrawer !== false && hasCashPayment(receipt)) {
    chunks.push(ESCPOS_COMMANDS.DRAWER_KICK);
  }

  // Multiply by copies if requested
  const singleCopyLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const singleCopy = new Uint8Array(singleCopyLength);
  let offset = 0;
  for (const c of chunks) {
    singleCopy.set(c, offset);
    offset += c.length;
  }

  const copies = Math.max(1, settings.copies || 1);
  if (copies === 1) {
    return singleCopy;
  }

  const out = new Uint8Array(singleCopyLength * copies);
  for (let i = 0; i < copies; i++) {
    out.set(singleCopy, i * singleCopyLength);
  }

  return out;
}
