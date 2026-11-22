import { ReceiptModel, RasterBitmap, ESCPOS_CONSTANTS } from "@universal-pos/shared";

export interface RenderReceiptOptions {
  paperWidth: "80mm" | "58mm";
  fontFamily?: string;
}

/**
 * Converts RGBA image data from a canvas 2D context to a 1-bit packed monochrome bitmap.
 * Each byte in the output represents 8 horizontal dots (MSB first: bit 7 = dot 0, bit 0 = dot 7).
 * A value of 1 represents a printed black dot; 0 represents white/unprinted paper.
 */
export function rgbaTo1BitBitmap(
  imageData: ImageData,
  width: number,
  height: number,
  threshold = 160
): RasterBitmap {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  const rgba = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < bytesPerRow; xByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const pixelIdx = (y * width + x) * 4;
          const r = rgba[pixelIdx];
          const g = rgba[pixelIdx + 1];
          const b = rgba[pixelIdx + 2];
          const a = rgba[pixelIdx + 3];

          // If pixel is semi-transparent, treat transparent as white
          if (a > 30) {
            // Standard perceptual luminance formula
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luminance < threshold) {
              byteVal |= 1 << (7 - bit);
            }
          }
        }
      }
      data[y * bytesPerRow + xByte] = byteVal;
    }
  }

  return { width, height, data };
}

function formatTaka(minor: number): string {
  const isNegative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${isNegative ? "-" : ""}৳${major.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Renders a receipt onto an HTML5 Canvas and returns a 1-bit monochrome raster bitmap.
 * Native support for Bangla fonts, ৳ symbol, Arabic/Latin numerals, and barcodes.
 */
export function renderReceiptToCanvasBitmap(
  receipt: ReceiptModel,
  options: RenderReceiptOptions
): RasterBitmap | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = options.paperWidth === "58mm" ? ESCPOS_CONSTANTS.DOTS_58MM : ESCPOS_CONSTANTS.DOTS_80MM;
  const fontFamily = options.fontFamily || "Hind Siliguri, Kalpurush, SolaimanLipi, -apple-system, sans-serif";

  // Temporary canvas to calculate dimensions dynamically
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Estimate total height needed
  // Header: ~180px
  // Items: ~40px per item
  // Totals: ~160px
  // Footer: ~100px
  const estimatedHeight = Math.max(400, 350 + receipt.items.length * 45 + (receipt.payments?.length || 1) * 35);
  canvas.width = width;
  canvas.height = estimatedHeight;

  // Background white
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, estimatedHeight);

  // Black text
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = 15;
  const padding = options.paperWidth === "58mm" ? 8 : 16;

  // 1. Shop Name
  ctx.font = `bold ${options.paperWidth === "58mm" ? "22px" : "28px"} ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(receipt.shopName, width / 2, y);
  y += options.paperWidth === "58mm" ? 28 : 34;

  // 2. Branch & Address
  ctx.font = `normal ${options.paperWidth === "58mm" ? "14px" : "16px"} ${fontFamily}`;
  if (receipt.branchName) {
    ctx.fillText(receipt.branchName, width / 2, y);
    y += 20;
  }
  if (receipt.branchAddress) {
    ctx.fillText(receipt.branchAddress, width / 2, y);
    y += 20;
  }
  if (receipt.receiptHeader) {
    ctx.fillText(receipt.receiptHeader, width / 2, y);
    y += 22;
  }

  // Divider
  y += 5;
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000000";
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 8;

  // Invoice & Date Metadata
  ctx.textAlign = "left";
  ctx.font = `normal ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;

  ctx.fillText(`চালান: ${receipt.invoiceNumber}`, padding, y);
  ctx.textAlign = "right";
  ctx.fillText(receipt.createdAt, width - padding, y);
  y += 20;

  ctx.textAlign = "left";
  const cashierText = `ক্যাশিয়ার: ${receipt.cashierName || "-"}`;
  const regText = `রেজিস্টার: ${receipt.registerName || "-"}`;
  ctx.fillText(cashierText, padding, y);
  ctx.textAlign = "right";
  ctx.fillText(regText, width - padding, y);
  y += 20;

  if (receipt.customerName || receipt.customerPhone) {
    ctx.textAlign = "left";
    ctx.fillText(`ক্রেতা: ${receipt.customerName || "সাধারণ ক্রেতা"}`, padding, y);
    if (receipt.customerPhone) {
      ctx.textAlign = "right";
      ctx.fillText(receipt.customerPhone, width - padding, y);
    }
    y += 20;
  }

  // Divider
  y += 4;
  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 8;

  // Table Columns Header
  ctx.font = `bold ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("বিবরণ", padding, y);
  ctx.textAlign = "right";
  ctx.fillText("মোট (৳)", width - padding, y);
  y += 20;

  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 6;

  // Items
  ctx.font = `normal ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;
  for (const item of receipt.items) {
    ctx.textAlign = "left";
    const variantTag = item.size ? ` [${item.size}]` : "";
    ctx.fillText(`${item.name}${variantTag}`, padding, y);

    ctx.textAlign = "right";
    ctx.fillText(formatTaka(item.totalMinor), width - padding, y);
    y += 18;

    // Sub-line: Qty x Unit Price
    ctx.font = `normal ${options.paperWidth === "58mm" ? "12px" : "13px"} monospace`;
    ctx.textAlign = "left";
    ctx.fillText(`   ${item.quantity} x ${formatTaka(item.unitPriceMinor)}`, padding, y);
    y += 20;
    ctx.font = `normal ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;
  }

  // Divider
  y += 4;
  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 8;

  // Financial Totals
  const drawRow = (label: string, value: string, bold = false) => {
    ctx.font = `${bold ? "bold" : "normal"} ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(label, padding, y);
    ctx.textAlign = "right";
    ctx.fillText(value, width - padding, y);
    y += 20;
  };

  drawRow("মোট পণ্য মূল্য:", formatTaka(receipt.grossMinor));
  if (receipt.discountMinor && receipt.discountMinor > 0) {
    drawRow("মোট ছাড়:", "-" + formatTaka(receipt.discountMinor));
  }
  if (receipt.taxMinor && receipt.taxMinor > 0) {
    drawRow("ভ্যাট / ট্যাক্স:", formatTaka(receipt.taxMinor));
  }

  // Double divider
  y += 4;
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 8;

  // TOTAL
  ctx.font = `bold ${options.paperWidth === "58mm" ? "16px" : "18px"} ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("সর্বমোট প্রদেয়:", padding, y);
  ctx.textAlign = "right";
  ctx.fillText(formatTaka(receipt.totalMinor), width - padding, y);
  y += 24;

  // Payments
  ctx.font = `normal ${options.paperWidth === "58mm" ? "13px" : "15px"} ${fontFamily}`;
  if (receipt.payments && receipt.payments.length > 0) {
    for (const p of receipt.payments) {
      const methodLabel = p.paymentMethod.toUpperCase() === "CASH" ? "ক্যাশ পরিশোধ:" : `পরিশোধ (${p.paymentMethod}):`;
      drawRow(methodLabel, formatTaka(p.amountMinor));
    }
  } else {
    drawRow("পরিশোধ:", formatTaka(receipt.paidMinor));
  }

  if (receipt.changeMinor > 0) {
    drawRow("ফেরত / চেঞ্জ:", formatTaka(receipt.changeMinor));
  }
  if (receipt.dueMinor && receipt.dueMinor > 0) {
    drawRow("বর্তমান বাকি:", formatTaka(receipt.dueMinor), true);
  }
  if (receipt.customerTotalDueMinor && receipt.customerTotalDueMinor > 0) {
    drawRow("মোট মোট বকেয়া:", formatTaka(receipt.customerTotalDueMinor));
  }

  // Loyalty
  if (receipt.pointsEarned || receipt.pointsRedeemed || receipt.newPointsBalance !== undefined) {
    y += 4;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    y += 6;
    if (receipt.pointsEarned) drawRow("অর্জিত পয়েন্ট:", `+${receipt.pointsEarned}`);
    if (receipt.pointsRedeemed) drawRow("ব্যবহৃত পয়েন্ট:", `-${receipt.pointsRedeemed}`);
    if (receipt.newPointsBalance !== undefined) drawRow("মোট পয়েন্ট ব্যালেন্স:", `${receipt.newPointsBalance}`);
  }

  // Footer & barcode
  y += 10;
  ctx.textAlign = "center";
  ctx.font = `normal ${options.paperWidth === "58mm" ? "12px" : "14px"} ${fontFamily}`;
  if (receipt.receiptFooter) {
    ctx.fillText(receipt.receiptFooter, width / 2, y);
    y += 20;
  }
  ctx.fillText("ধন্যবাদ! আবার আসবেন।", width / 2, y);
  y += 28;

  // Actual rendered height
  const actualHeight = Math.ceil(y);
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = width;
  finalCanvas.height = actualHeight;
  const finalCtx = finalCanvas.getContext("2d");
  if (!finalCtx) return null;

  finalCtx.drawImage(canvas, 0, 0, width, actualHeight, 0, 0, width, actualHeight);
  const finalImgData = finalCtx.getImageData(0, 0, width, actualHeight);

  return rgbaTo1BitBitmap(finalImgData, width, actualHeight);
}
