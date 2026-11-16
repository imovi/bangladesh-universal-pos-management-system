"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { formatPaymentMethod } from "@/i18n/formatters";
import {
  RotateCcw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Printer,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { v7 as uuidv7 } from "uuid";

export interface ReturnSelectedLine {
  saleItemId: string;
  variantId: string;
  productName: string;
  variantName?: string;
  sku: string;
  quantity: number;
  maxReturnable: number;
  condition: "resellable" | "damaged";
  unitPriceMinor: number;
  estimatedLineRefundMinor: number;
}

export interface ReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  branchId: string;
  drawerCashMinor?: number;
  initialInvoiceNumber?: string;
  onStartExchange?: (
    originalSale: any,
    returnItems: ReturnSelectedLine[],
    reason: string,
    overrideReason?: string,
  ) => void;
  onReturnCompleted?: (returnResult: any) => void;
}

export function ReturnModal({
  isOpen,
  onClose,
  shiftId,
  branchId: _branchId,
  drawerCashMinor = 0,
  initialInvoiceNumber,
  onStartExchange,
  onReturnCompleted,
}: ReturnModalProps) {
  const { apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const [invoiceQuery, setInvoiceQuery] = useState(initialInvoiceNumber || "");
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState<any | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [returnLines, setReturnLines] = useState<
    Array<{
      saleItemId: string;
      variantId: string;
      productName: string;
      variantName?: string;
      sku: string;
      soldQty: number;
      returnedQty: number;
      returnableQty: number;
      unitPriceMinor: number;
      taxMinor: number;
      totalMinor: number;
      selectedQty: number;
      condition: "resellable" | "damaged";
    }>
  >([]);

  const [refundMethod, setRefundMethod] = useState<string>("cash");
  const [returnReason, setReturnReason] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [isOutsideWindow, setIsOutsideWindow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Return receipt view after direct return
  const [completedReturn, setCompletedReturn] = useState<any | null>(null);

  const resetState = useCallback(() => {
    setInvoiceQuery("");
    setSale(null);
    setSearchError(null);
    setReturnLines([]);
    setRefundMethod("cash");
    setReturnReason("");
    setOverrideReason("");
    setIsOutsideWindow(false);
    setSubmitting(false);
    setSubmitError(null);
    setCompletedReturn(null);
  }, []);

  const handleSearchInvoice = useCallback(
    async (invoiceToFind?: string) => {
      const q = (invoiceToFind || invoiceQuery).trim();
      if (!q) return;

      try {
        setSearching(true);
        setSearchError(null);
        setSale(null);
        setReturnLines([]);

        // Find sale by invoiceNumber or id
        const res = await apiFetch(`/sales?search=${encodeURIComponent(q)}&limit=1`);
        if (!res.ok) {
          setSearchError(
            locale === "bn" ? "ইনভয়েস অনুসন্ধান ব্যর্থ হয়েছে" : "Failed to search invoice",
          );
          return;
        }

        const json = await res.json();
        const salesList = Array.isArray(json.data) ? json.data : json.data?.items || [];
        const found = salesList.find(
          (s: any) =>
            s.invoiceNumber.toLowerCase() === q.toLowerCase() || s.id === q,
        );

        if (!found) {
          setSearchError(
            locale === "bn"
              ? "এই নম্বরের কোন বিক্রয় রশিদ পাওয়া যায়নি"
              : "No sale found with this invoice number",
          );
          return;
        }

        // Fetch full sale detail
        const detailRes = await apiFetch(`/sales/${found.id}`);
        if (!detailRes.ok) {
          setSearchError(
            locale === "bn"
              ? "বিক্রয় বিবরণ লোড করতে সমস্যা হয়েছে"
              : "Failed to load sale details",
          );
          return;
        }

        const detailJson = await detailRes.json();
        const saleData = detailJson.data;

        if (saleData.status === "voided") {
          setSearchError(
            locale === "bn"
              ? "এই বিক্রয়টি বাতিলকৃত (Voided), পণ্য ফেরত সম্ভব নয়"
              : "This sale is voided, returns are not allowed",
          );
          return;
        }

        // Check return window (e.g. 7 days default)
        const saleAgeDays =
          (Date.now() - new Date(saleData.createdAt).getTime()) /
          (1000 * 60 * 60 * 24);
        const outside = saleAgeDays > 7;
        setIsOutsideWindow(outside);

        setSale(saleData);

        // Map line items with returnable info
        const lines = saleData.items.map((it: any) => {
          const sold = Number(it.quantity);
          const ret = Number(it.returnedQuantity || 0);
          const returnable = Math.max(0, sold - ret);
          const variantOptions = it.variant?.optionValues?.length
            ? it.variant.optionValues
                .map((ov: any) => ov.optionValue?.value || "")
                .filter(Boolean)
                .join(" / ")
            : undefined;

          return {
            saleItemId: it.id,
            variantId: it.variantId,
            productName: it.variant?.product?.name || "Product",
            variantName: variantOptions,
            sku: it.variant?.sku || "",
            soldQty: sold,
            returnedQty: ret,
            returnableQty: returnable,
            unitPriceMinor: Number(it.unitPriceMinor),
            taxMinor: Number(it.taxMinor),
            totalMinor: Number(it.totalMinor),
            selectedQty: 0,
            condition: "resellable" as const,
          };
        });

        setReturnLines(lines);
      } catch {
        setSearchError(
          locale === "bn"
            ? "সার্ভারের সাথে সংযোগে ত্রুটি হয়েছে"
            : "Error connecting to server",
        );
      } finally {
        setSearching(false);
      }
    },
    [apiFetch, invoiceQuery, locale],
  );

  useEffect(() => {
    if (isOpen && initialInvoiceNumber) {
      setInvoiceQuery(initialInvoiceNumber);
      handleSearchInvoice(initialInvoiceNumber);
    }
  }, [isOpen, initialInvoiceNumber, handleSearchInvoice]);

  const updateLineQty = (index: number, qty: number) => {
    setReturnLines((prev) => {
      const copy = [...prev];
      const max = copy[index].returnableQty;
      copy[index].selectedQty = Math.max(0, Math.min(qty, max));
      return copy;
    });
  };

  const updateLineCondition = (
    index: number,
    cond: "resellable" | "damaged",
  ) => {
    setReturnLines((prev) => {
      const copy = [...prev];
      copy[index].condition = cond;
      return copy;
    });
  };

  // Estimated refund calculation
  const totalSelectedQty = returnLines.reduce((s, l) => s + l.selectedQty, 0);
  const estimatedRefundMinor = returnLines.reduce((sum, l) => {
    if (l.selectedQty <= 0) return sum;
    // Approximate line refund for UI live estimate
    const unitTotal = l.soldQty > 0 ? l.totalMinor / l.soldQty : 0;
    return sum + Math.round(unitTotal * l.selectedQty);
  }, 0);

  // Submit direct return
  const handleConfirmDirectReturn = async () => {
    if (!sale) return;
    const selected = returnLines.filter((l) => l.selectedQty > 0);
    if (selected.length === 0) {
      setSubmitError(
        locale === "bn"
          ? "অন্তত একটি পণ্যের ফেরত পরিমাণ নির্বাচন করুন"
          : "Please select quantity for at least one item",
      );
      return;
    }

    if (isOutsideWindow) {
      if (!overrideReason.trim() || overrideReason.trim().length < 3) {
        setSubmitError(
          locale === "bn"
            ? "৭ দিনের সময়সীমা পার হওয়ায় অনুমোদনের কারণ আবশ্যক"
            : "Override reason required for returns past return window",
        );
        return;
      }
    }

    // Check drawer cash for cash refund
    if (refundMethod === "cash" && estimatedRefundMinor > drawerCashMinor) {
      setSubmitError(
        locale === "bn"
          ? `ক্যাশ ড্রয়ারে পর্যাপ্ত নগদ টাকা নেই (ড্রয়ার ব্যালেন্স: ${formatMoney(drawerCashMinor)}, প্রয়োজন: ${formatMoney(estimatedRefundMinor)})`
          : `Drawer cash insufficient (Drawer: ${formatMoney(drawerCashMinor)}, Required: ${formatMoney(estimatedRefundMinor)})`,
      );
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const returnId = uuidv7();

      const payload = {
        id: returnId,
        shiftId,
        refundMethod,
        reason: returnReason || "Customer return",
        overrideReason: isOutsideWindow ? overrideReason : undefined,
        items: selected.map((s) => ({
          saleItemId: s.saleItemId,
          quantity: s.selectedQty,
          condition: s.condition,
        })),
      };

      const res = await apiFetch(`/sales/${sale.id}/returns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": returnId,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        setSubmitError(
          errJson.error?.message ||
            errJson.message ||
            (locale === "bn" ? "ফেরত সম্পন্ন হতে ব্যর্থ হয়েছে" : "Failed to process return"),
        );
        return;
      }

      const resJson = await res.json();
      setCompletedReturn({
        ...resJson.data,
        saleInvoiceNumber: sale.invoiceNumber,
        branchName: sale.branch?.name,
        customerName: sale.customer?.name,
      });

      if (onReturnCompleted) {
        onReturnCompleted(resJson.data);
      }
    } catch {
      setSubmitError(
        locale === "bn"
          ? "সার্ভারের সাথে সংযোগে ত্রুটি হয়েছে"
          : "Network error processing return",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Switch to Exchange
  const handleProceedToExchange = () => {
    if (!sale || !onStartExchange) return;
    const selected = returnLines
      .filter((l) => l.selectedQty > 0)
      .map((l) => ({
        saleItemId: l.saleItemId,
        variantId: l.variantId,
        productName: l.productName,
        variantName: l.variantName,
        sku: l.sku,
        quantity: l.selectedQty,
        maxReturnable: l.returnableQty,
        condition: l.condition,
        unitPriceMinor: l.unitPriceMinor,
        estimatedLineRefundMinor: Math.round(
          (l.soldQty > 0 ? l.totalMinor / l.soldQty : 0) * l.selectedQty,
        ),
      }));

    if (selected.length === 0) {
      setSubmitError(
        locale === "bn"
          ? "বদল করার জন্য অন্তত একটি পণ্য নির্বাচন করুন"
          : "Please select at least one item to exchange",
      );
      return;
    }

    if (isOutsideWindow && (!overrideReason.trim() || overrideReason.trim().length < 3)) {
      setSubmitError(
        locale === "bn"
          ? "৭ দিনের সময়সীমা পার হওয়ায় অনুমোদনের কারণ আবশ্যক"
          : "Override reason required for exchange past return window",
      );
      return;
    }

    onStartExchange(
      sale,
      selected,
      returnReason || "Customer exchange",
      isOutsideWindow ? overrideReason : undefined,
    );
    onClose();
    resetState();
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          resetState();
        }
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            {completedReturn
              ? locale === "bn"
                ? "ফেরত রসিদ (Return Receipt)"
                : "Return Receipt"
              : locale === "bn"
              ? "পণ্য ফেরত ও বদল (Returns & Exchanges)"
              : "Returns & Exchanges"}
          </DialogTitle>
        </DialogHeader>

        {/* 1. Success Receipt View */}
        {completedReturn ? (
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
                  <strong>{formatMoney(completedReturn.totalRefundMinor)}</strong> (
                  {formatPaymentMethod(completedReturn.refundMethod, strings)})
                </p>
              </div>
            </div>

            {/* Thermal Receipt Preview */}
            <div className="bg-neutral-50 dark:bg-neutral-900 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-6 font-mono text-xs max-w-sm mx-auto shadow-sm">
              <div className="text-center space-y-1 pb-3 border-b border-dashed border-neutral-300">
                <p className="font-bold text-sm tracking-wider uppercase">
                  {completedReturn.branchName || "UNIVERSAL POS STORE"}
                </p>
                <p className="font-bold text-xs uppercase bg-neutral-200 dark:bg-neutral-800 py-0.5 rounded">
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
              <Button onClick={handlePrintReceipt} variant="outline">
                <Printer className="h-4 w-4 mr-2" />
                {locale === "bn" ? "রসিদ প্রিন্ট করুন" : "Print Receipt"}
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  resetState();
                }}
              >
                {locale === "bn" ? "সম্পন্ন" : "Done"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* 2. Interactive Return / Exchange Flow */
          <div className="space-y-5">
            {/* Invoice Search Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                <Input
                  placeholder={
                    locale === "bn"
                      ? "মূল ইনভয়েস নম্বর লিখুন বা স্ক্যান করুন (যেমন: REG01-261116-0001)..."
                      : "Scan or enter invoice number..."
                  }
                  value={invoiceQuery}
                  onChange={(e) => setInvoiceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearchInvoice();
                    }
                  }}
                  className="pl-9 font-mono"
                  autoFocus
                />
              </div>
              <Button
                onClick={() => handleSearchInvoice()}
                disabled={searching || !invoiceQuery.trim()}
              >
                {searching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : locale === "bn" ? (
                  "খুঁজুন"
                ) : (
                  "Find Sale"
                )}
              </Button>
            </div>

            {searchError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {searchError}
              </div>
            )}

            {sale && (
              <div className="space-y-4">
                {/* Sale info banner */}
                <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
                      {sale.invoiceNumber}
                    </span>
                    <span className="text-neutral-500 text-xs ml-2">
                      ({formatDateTime(sale.createdAt)})
                    </span>
                    {sale.customer && (
                      <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                        {sale.customer.name} ({sale.customer.phone})
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isOutsideWindow && (
                      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {locale === "bn" ? "৭ দিন অতিক্রান্ত (অনুমোদন প্রযোজ্য)" : "Return Window Exceeded"}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="font-mono">
                      {locale === "bn" ? "মূল বিক্রি:" : "Original Total:"}{" "}
                      {formatMoney(sale.totalMinor)}
                    </Badge>
                  </div>
                </div>

                {/* Return window override reason input */}
                {isOutsideWindow && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-1.5">
                    <label className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {locale === "bn"
                        ? "সময়সীমা অতিক্রান্ত ওভাররাইড কারণ (ম্যানেজার/মালিক অনুমোদন):"
                        : "Override Reason (Manager/Owner override required):"}
                    </label>
                    <Input
                      placeholder={
                        locale === "bn"
                          ? "সময় পার হওয়ার পরেও ফেরত নেওয়ার কারণ লিখুন..."
                          : "State reason for accepting late return..."
                      }
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="bg-white dark:bg-neutral-900 text-xs"
                    />
                  </div>
                )}

                {/* Items selection table */}
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-semibold border-b border-neutral-200 dark:border-neutral-800">
                      <tr>
                        <th className="py-2.5 px-3 text-left">{locale === "bn" ? "পণ্য" : "Item"}</th>
                        <th className="py-2.5 px-2 text-center">{locale === "bn" ? "বিক্রি" : "Sold"}</th>
                        <th className="py-2.5 px-2 text-center">{locale === "bn" ? "ফেরতযোগ্য" : "Available"}</th>
                        <th className="py-2.5 px-3 text-center">{locale === "bn" ? "ফেরত পরিমাণ" : "Return Qty"}</th>
                        <th className="py-2.5 px-3 text-center">{locale === "bn" ? "অবস্থা" : "Condition"}</th>
                        <th className="py-2.5 px-3 text-right">{locale === "bn" ? "আনুমানিক রিফান্ড" : "Est. Refund"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {returnLines.map((line, idx) => {
                        const isAvailable = line.returnableQty > 0;
                        const lineEstRefund = Math.round(
                          (line.soldQty > 0 ? line.totalMinor / line.soldQty : 0) *
                            line.selectedQty,
                        );

                        return (
                          <tr
                            key={line.saleItemId}
                            className={!isAvailable ? "opacity-50 bg-neutral-50 dark:bg-neutral-900/40" : ""}
                          >
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                                {line.productName}
                              </div>
                              <div className="text-[10px] text-neutral-500 font-mono">
                                {line.sku} {line.variantName ? `• ${line.variantName}` : ""}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center">{line.soldQty}</td>
                            <td className="py-2.5 px-2 text-center font-bold text-amber-700 dark:text-amber-400">
                              {line.returnableQty}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-xs"
                                  disabled={!isAvailable || line.selectedQty <= 0}
                                  onClick={() => updateLineQty(idx, line.selectedQty - 1)}
                                >
                                  -
                                </Button>
                                <Input
                                  type="number"
                                  min={0}
                                  max={line.returnableQty}
                                  value={line.selectedQty}
                                  onChange={(e) =>
                                    updateLineQty(idx, parseInt(e.target.value, 10) || 0)
                                  }
                                  disabled={!isAvailable}
                                  className="h-6 w-12 text-center px-1 text-xs font-bold"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-xs"
                                  disabled={!isAvailable || line.selectedQty >= line.returnableQty}
                                  onClick={() => updateLineQty(idx, line.selectedQty + 1)}
                                >
                                  +
                                </Button>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {line.selectedQty > 0 ? (
                                <Select
                                  value={line.condition}
                                  onValueChange={(val: "resellable" | "damaged") =>
                                    updateLineCondition(idx, val)
                                  }
                                >
                                  <SelectTrigger className="h-6 text-[11px] w-28 mx-auto">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="resellable">
                                      {locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable"}
                                    </SelectItem>
                                    <SelectItem value="damaged">
                                      {locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-neutral-400">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-red-600 dark:text-red-400">
                              {line.selectedQty > 0 ? `-${formatMoney(lineEstRefund)}` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Common Reason and Refund Method for Direct Return */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
                      {locale === "bn" ? "ফেরতের কারণ:" : "Return Reason:"}
                    </label>
                    <Input
                      placeholder={
                        locale === "bn"
                          ? "যেমন: সাইজ সমস্যা, পণ্য পছন্দ হয়নি..."
                          : "E.g. Size mismatch, defective..."
                      }
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
                      {locale === "bn"
                        ? "রিফান্ড মাধ্যম (শুধু ফেরতের জন্য):"
                        : "Refund Method (Return Only):"}
                    </label>
                    <Select value={refundMethod} onValueChange={setRefundMethod}>
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">
                          {formatPaymentMethod("cash", strings)} (
                          {locale === "bn" ? "ড্রয়ার ক্যাশ:" : "Drawer:"}{" "}
                          {formatMoney(drawerCashMinor)})
                        </SelectItem>
                        <SelectItem value="card">{formatPaymentMethod("card", strings)}</SelectItem>
                        <SelectItem value="bkash">{formatPaymentMethod("bkash", strings)}</SelectItem>
                        <SelectItem value="nagad">{formatPaymentMethod("nagad", strings)}</SelectItem>
                        <SelectItem value="other">{formatPaymentMethod("other", strings)}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Summary Banner */}
                <div className="p-4 bg-neutral-100 dark:bg-neutral-800 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-xs text-neutral-500 block">
                      {locale === "bn"
                        ? "নির্বাচিত ফেরত আইটেম:"
                        : "Selected Return Items:"}
                    </span>
                    <span className="text-sm font-semibold">
                      {totalSelectedQty} {locale === "bn" ? "টি" : "units"}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-neutral-500 block">
                      {locale === "bn"
                        ? "মোট আনুমানিক রিফান্ড:"
                        : "Estimated Refund Total:"}
                    </span>
                    <span className="text-2xl font-extrabold text-red-600 dark:text-red-400 font-mono">
                      -{formatMoney(estimatedRefundMinor)}
                    </span>
                  </div>
                </div>

                {submitError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-400 text-xs">
                    {submitError}
                  </div>
                )}

                {/* Action Buttons: Direct Return OR Exchange */}
                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-blue-500 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    disabled={totalSelectedQty <= 0 || submitting}
                    onClick={handleProceedToExchange}
                  >
                    <ArrowRight className="h-4 w-4 mr-2" />
                    {locale === "bn"
                      ? "পণ্য বদল করুন (Switch to Exchange)"
                      : "Proceed to Exchange"}
                  </Button>

                  <Button
                    type="button"
                    variant="default"
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={totalSelectedQty <= 0 || submitting}
                    onClick={handleConfirmDirectReturn}
                  >
                    {submitting ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-2" />
                    )}
                    {locale === "bn" ? "শুধু টাকা ফেরত দিন" : "Confirm Refund Only"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
