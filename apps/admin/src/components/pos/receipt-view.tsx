"use client";

import React, { useState } from "react";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { PrinterPaperSize, getPrinterPaperSize, setPrinterPaperSize } from "@/lib/pos/pos-storage";
import { Printer, RotateCcw, CheckCircle2 } from "lucide-react";

export interface ReceiptData {
  saleId: string;
  invoiceNumber: string;
  createdAt: string;
  cashierName: string;
  registerName: string;
  branchName: string;
  branchAddress?: string;
  customerName?: string;
  customerPhone?: string;
  shopName: string;
  receiptHeader?: string;
  receiptFooter?: string;
  isExchange?: boolean;
  exchangeInfo?: {
    returnNumber: string;
    originalInvoice: string;
    returnedItems: Array<{
      name: string;
      quantity: number;
      refundMinor: number;
      condition?: string;
    }>;
    totalRefundMinor: number;
    differenceMinor: number;
    refundMethod?: string;
  };
  items: Array<{
    name: string;
    sku: string;
    size?: string;
    color?: string;
    quantity: number;
    unitPriceMinor: number;
    grossMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  }>;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  dueMinor?: number;
  customerTotalDueMinor?: number;
  payments: Array<{
    paymentMethod: string;
    amountMinor: number;
    reference?: string;
  }>;
}

interface ReceiptViewProps {
  receipt: ReceiptData;
  onNewSale: () => void;
  timezone?: string;
}

export function ReceiptView({ receipt, onNewSale, timezone = "Asia/Dhaka" }: ReceiptViewProps) {
  const { strings, locale } = useTranslation();
  const [paperSize, setPaperSize] = useState<PrinterPaperSize>(getPrinterPaperSize());

  const handleSizeChange = (size: PrinterPaperSize) => {
    setPaperSize(size);
    setPrinterPaperSize(size);
  };

  const handlePrint = () => {
    window.print();
  };

  const getMethodLabel = (method: string) => {
    const map: Record<string, string> = {
      cash: locale === "bn" ? "ক্যাশ" : "Cash",
      bkash: locale === "bn" ? "বিকাশ" : "bKash",
      nagad: locale === "bn" ? "নগদ" : "Nagad",
      rocket: locale === "bn" ? "রকেট" : "Rocket",
      card: locale === "bn" ? "কার্ড" : "Card",
      bank_transfer: locale === "bn" ? "ব্যাংক ট্রান্সফার" : "Bank Transfer",
    };
    return map[method] || method.toUpperCase();
  };

  const widthClass =
    paperSize === "58mm" ? "w-[58mm] max-w-[58mm]" : paperSize === "80mm" ? "w-[80mm] max-w-[80mm]" : "w-[210mm] max-w-2xl";

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-6 bg-muted/20 min-h-full">
      {/* Action Controls (Hidden on Print) */}
      <div className="print:hidden w-full max-w-md bg-card border border-border p-4 rounded-xl shadow-sm mb-6 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
            <CheckCircle2 className="h-5 w-5" />
            <span>{strings.pos.saleSuccess}</span>
          </div>
          <span className="text-xs font-mono font-medium px-2 py-0.5 bg-muted rounded">
            {receipt.invoiceNumber}
          </span>
        </div>

        {/* Paper Size Selector */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs font-medium text-muted-foreground">{strings.pos.paperSize}:</span>
          <div className="flex gap-1">
            {(["80mm", "58mm", "a4"] as PrinterPaperSize[]).map((size) => (
              <Button
                key={size}
                variant={paperSize === size ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs font-mono"
                onClick={() => handleSizeChange(size)}
              >
                {size.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* Print & New Sale Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handlePrint}
            data-testid="print-receipt-button"
            className="flex-1 flex items-center justify-center gap-2 h-10 font-medium"
          >
            <Printer className="h-4 w-4" />
            <span>{strings.pos.printReceipt}</span>
          </Button>
          <Button
            onClick={onNewSale}
            variant="outline"
            data-testid="new-sale-button"
            className="flex-1 flex items-center justify-center gap-2 h-10 font-medium"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{strings.pos.newSale}</span>
          </Button>
        </div>
      </div>

      {/* Printable Receipt Paper Container */}
      <div
        id="pos-receipt-print"
        className={`${widthClass} bg-white text-black p-4 font-mono text-[12px] leading-tight shadow-md border border-gray-200 print:shadow-none print:border-none print:m-0 print:p-2`}
      >
        {/* Header */}
        <div className="text-center pb-2 mb-2 border-b border-dashed border-gray-400">
          <h2 className="text-base font-bold uppercase tracking-wide">{receipt.shopName}</h2>
          <p className="text-[11px] font-sans text-gray-700">{receipt.branchName}</p>
          {receipt.branchAddress && <p className="text-[10px] text-gray-600">{receipt.branchAddress}</p>}
          {receipt.receiptHeader && (
            <p className="text-[11px] text-gray-700 mt-1 whitespace-pre-wrap">{receipt.receiptHeader}</p>
          )}
          {receipt.isExchange && (
            <p className="font-bold text-xs uppercase bg-gray-200 py-0.5 rounded mt-1 font-mono">
              {locale === "bn" ? "পণ্য বদল চালান (EXCHANGE)" : "EXCHANGE RECEIPT"}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-1 pb-2 mb-2 border-b border-dashed border-gray-400 text-[11px]">
          <div className="flex justify-between">
            <span>{locale === "bn" ? "চালান নং:" : "Invoice:"}</span>
            <span className="font-bold">{receipt.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>{locale === "bn" ? "তারিখ:" : "Date:"}</span>
            <span>{formatDateTime(receipt.createdAt, timezone)}</span>
          </div>
          <div className="flex justify-between">
            <span>{locale === "bn" ? "রেজিস্টার:" : "Register:"}</span>
            <span>{receipt.registerName}</span>
          </div>
          <div className="flex justify-between">
            <span>{locale === "bn" ? "ক্যাশিয়ার:" : "Cashier:"}</span>
            <span>{receipt.cashierName}</span>
          </div>
          <div className="flex justify-between">
            <span>{locale === "bn" ? "ক্রেতা:" : "Customer:"}</span>
            <span>{receipt.customerName || (locale === "bn" ? "সাধারণ ক্রেতা" : "Walk-in")}</span>
          </div>
          {receipt.customerPhone && (
            <div className="flex justify-between">
              <span>{locale === "bn" ? "ফোন:" : "Phone:"}</span>
              <span>{receipt.customerPhone}</span>
            </div>
          )}
        </div>

        {/* Exchange Returned Items Summary */}
        {receipt.exchangeInfo && (
          <div className="pb-2 mb-2 border-b border-dashed border-gray-400 text-[11px] space-y-1 bg-gray-50 p-2 rounded">
            <div className="font-bold text-gray-800">
              {locale === "bn" ? "ফেরতকৃত পণ্য (Return):" : "Returned Items:"}
            </div>
            <div className="text-[10px] text-gray-600">
              {locale === "bn" ? "মূল চালান:" : "Orig Invoice:"} {receipt.exchangeInfo.originalInvoice}
            </div>
            {receipt.exchangeInfo.returnedItems.map((ri, idx) => (
              <div key={idx} className="flex justify-between text-[10px]">
                <span>{ri.name} x{ri.quantity}</span>
                <span className="font-mono text-red-600">-{formatMoney(ri.refundMinor)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold pt-1 border-t border-gray-200">
              <span>{locale === "bn" ? "মোট ফেরত জমা:" : "Total Return Credit:"}</span>
              <span className="font-mono text-red-600">-{formatMoney(receipt.exchangeInfo.totalRefundMinor)}</span>
            </div>
          </div>
        )}

        {/* Items List */}
        <div className="pb-2 mb-2 border-b border-dashed border-gray-400">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="pb-1">{locale === "bn" ? "বিবরণ" : "Item"}</th>
                <th className="pb-1 text-center">{locale === "bn" ? "পরিমাণ" : "Qty"}</th>
                <th className="pb-1 text-right">{locale === "bn" ? "দর" : "Price"}</th>
                <th className="pb-1 text-right">{locale === "bn" ? "মোট" : "Total"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipt.items.map((item, idx) => (
                <tr key={idx} className="align-top">
                  <td className="py-1 pr-1 font-sans">
                    <div className="font-medium">{item.name}</div>
                    {(item.size || item.color) && (
                      <div className="text-[10px] text-gray-600">
                        {[item.color, item.size].filter(Boolean).join(" / ")}
                      </div>
                    )}
                    {item.discountMinor > 0 && (
                      <div className="text-[10px] text-gray-500 whitespace-nowrap">
                        -{formatMoney(item.discountMinor)}
                      </div>
                    )}
                  </td>
                  <td className="py-1 text-center tabular-nums whitespace-nowrap">{item.quantity}</td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">{formatMoney(item.unitPriceMinor)}</td>
                  <td className="py-1 text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(item.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="space-y-1 pb-2 mb-2 border-b border-dashed border-gray-400 text-[11px]">
          <div className="flex justify-between">
            <span>{strings.pos.subtotal}:</span>
            <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.grossMinor)}</span>
          </div>
          {receipt.discountMinor > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>{strings.pos.discount}:</span>
              <span className="tabular-nums whitespace-nowrap">-{formatMoney(receipt.discountMinor)}</span>
            </div>
          )}
          {receipt.taxMinor > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>{strings.pos.tax}:</span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.taxMinor)}</span>
            </div>
          )}
          {receipt.exchangeInfo && (
            <div className="flex justify-between text-gray-700">
              <span>{locale === "bn" ? "ফেরত বাবদ সমন্বয়:" : "Return Credit:"}</span>
              <span className="tabular-nums font-mono text-red-600">-{formatMoney(receipt.exchangeInfo.totalRefundMinor)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold pt-1 border-t border-gray-300">
            <span>{receipt.exchangeInfo ? (locale === "bn" ? "নিট সমন্বয়:" : "Net Difference:") : strings.pos.payable}:</span>
            <span className="tabular-nums whitespace-nowrap">
              {receipt.exchangeInfo
                ? (receipt.exchangeInfo.differenceMinor > 0
                    ? `+${formatMoney(receipt.exchangeInfo.differenceMinor)}`
                    : formatMoney(receipt.exchangeInfo.differenceMinor))
                : formatMoney(receipt.totalMinor)}
            </span>
          </div>
        </div>

        {/* Payment Breakdown */}
        <div className="space-y-1 pb-2 mb-2 border-b border-dashed border-gray-400 text-[11px]">
          {receipt.payments.map((p, idx) => (
            <div key={idx} className="flex justify-between">
              <span>
                {getMethodLabel(p.paymentMethod)}
                {p.reference ? ` (${p.reference})` : ""}:
              </span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(p.amountMinor)}</span>
            </div>
          ))}
          {receipt.payments.length > 0 && (
            <div className="flex justify-between font-semibold pt-1 border-t border-gray-200">
              <span>{locale === "bn" ? "মোট পরিশোধ:" : "Total Paid:"}</span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.paidMinor)}</span>
            </div>
          )}
          {receipt.changeMinor > 0 && (
            <div className="flex justify-between font-semibold pt-1">
              <span>{strings.pos.change}:</span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.changeMinor)}</span>
            </div>
          )}
          {(receipt.dueMinor ?? 0) > 0 && (
            <div className="flex justify-between font-bold text-amber-800 pt-1">
              <span>{locale === "bn" ? "এই ভাউচারে বাকি:" : "Due on Invoice:"}</span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.dueMinor!)}</span>
            </div>
          )}
          {receipt.customerTotalDueMinor !== undefined && receipt.customerTotalDueMinor > 0 && (
            <div className="flex justify-between font-bold text-red-600 pt-1 border-t border-dashed border-gray-300">
              <span>{locale === "bn" ? "গ্রাহকের মোট বকেয়া:" : "Total Customer Due:"}</span>
              <span className="tabular-nums whitespace-nowrap">{formatMoney(receipt.customerTotalDueMinor)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center pt-1 text-[10px] text-gray-600 space-y-1 font-sans">
          {receipt.receiptFooter && <p className="whitespace-pre-wrap">{receipt.receiptFooter}</p>}
          <p className="font-medium text-gray-800">
            {locale === "bn" ? "ধন্যবাদ আবার আসবেন!" : "Thank you for shopping with us!"}
          </p>
        </div>
      </div>
    </div>
  );
}
