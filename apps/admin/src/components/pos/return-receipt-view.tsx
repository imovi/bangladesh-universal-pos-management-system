"use client";

import React from "react";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { formatPaymentMethod } from "@/i18n/formatters";
import { CheckCircle2, Printer } from "lucide-react";

export interface ReturnReceiptViewProps {
  completedReturn: any;
  onClose: () => void;
  onPrint?: () => void;
}

export function ReturnReceiptView({
  completedReturn,
  onClose,
  onPrint,
}: ReturnReceiptViewProps) {
  const { strings, locale } = useTranslation();

  const handlePrint = () => {
    if (onPrint) onPrint();
    else window.print();
  };

  return (
    <div className="space-y-6">
      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div>
          <p className="font-semibold text-emerald-950 dark:text-emerald-100 text-sm">
            {locale === "bn"
              ? "পণ্য ফেরত সফলভাবে সম্পন্ন হয়েছে!"
              : "Return processed successfully!"}
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            {locale === "bn" ? "রিফান্ড প্রদান করা হয়েছে:" : "Refund issued:"}{" "}
            <strong data-testid="return-receipt-refund">{formatMoney(completedReturn.totalRefundMinor)}</strong> (
            {formatPaymentMethod(completedReturn.refundMethod, strings)})
          </p>
        </div>
      </div>

      {/* Thermal Receipt Preview */}
      <div
        id="pos-return-receipt-print"
        className="bg-neutral-50 dark:bg-neutral-900 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-6 font-mono text-xs max-w-sm mx-auto shadow-sm"
      >
        <div className="text-center space-y-1 pb-3 border-b border-dashed border-neutral-300">
          <p className="font-bold text-sm tracking-wider uppercase">
            {completedReturn.branchName || "UNIVERSAL POS STORE"}
          </p>
          <p
            data-testid="return-receipt-title"
            className="font-bold text-xs uppercase bg-neutral-200 dark:bg-neutral-800 py-0.5 rounded"
          >
            {locale === "bn" ? "ফেরত রসিদ" : "RETURN RECEIPT"}
          </p>
          <p className="text-neutral-500">
            Return #: {completedReturn.returnNumber}
          </p>
          <p className="text-neutral-500">
            Sale #: {completedReturn.saleInvoiceNumber}
          </p>
          <p className="text-neutral-500">
            {formatDateTime(completedReturn.createdAt)}
          </p>
        </div>

        <div className="py-3 space-y-2 border-b border-dashed border-neutral-300">
          {completedReturn.items?.map((it: any, i: number) => (
            <div key={i} className="flex justify-between items-start">
              <div>
                <div className="font-medium text-neutral-800 dark:text-neutral-200">
                  {it.variant?.product?.name || "Item"}
                </div>
                <div className="text-[10px] text-neutral-500">
                  x{it.quantity} •{" "}
                  {it.condition === "resellable"
                    ? locale === "bn"
                      ? "পুনর্বিক্রয়যোগ্য"
                      : "Resellable"
                    : locale === "bn"
                    ? "ক্ষতিগ্রস্ত"
                    : "Damaged"}
                </div>
              </div>
              <span className="font-medium">
                -{formatMoney(it.totalRefundMinor)}
              </span>
            </div>
          ))}
        </div>

        <div className="pt-3 space-y-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
          <div className="flex justify-between text-sm">
            <span>{locale === "bn" ? "মোট রিফান্ড:" : "Total Refund:"}</span>
            <span className="text-red-600 font-bold">
              -{formatMoney(completedReturn.totalRefundMinor)}
            </span>
          </div>
          <div className="flex justify-between text-xs text-neutral-500 font-normal">
            <span>{locale === "bn" ? "মাধ্যম:" : "Method:"}</span>
            <span className="capitalize">
              {formatPaymentMethod(completedReturn.refundMethod, strings)}
            </span>
          </div>
        </div>
      </div>

      <DialogFooter className="flex sm:justify-between items-center gap-2">
        <Button onClick={handlePrint} variant="outline" data-testid="print-return-receipt-button">
          <Printer className="h-4 w-4 mr-2" />
          {locale === "bn" ? "রসিদ প্রিন্ট করুন" : "Print Receipt"}
        </Button>
        <Button onClick={onClose} data-testid="return-receipt-done-button">
          {locale === "bn" ? "সম্পন্ন" : "Done"}
        </Button>
      </DialogFooter>
    </div>
  );
}
