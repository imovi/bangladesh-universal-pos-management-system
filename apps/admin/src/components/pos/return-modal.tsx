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
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { v7 as uuidv7 } from "uuid";
import { ReturnReceiptView } from "./return-receipt-view";
import { ReturnLinesTable, ReturnLineItem } from "./return-lines-table";

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

  const [returnLines, setReturnLines] = useState<ReturnLineItem[]>([]);
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
          setSearchError(strings.pos.searchInvoiceFailed);
          return;
        }

        const json = await res.json();
        const salesList = Array.isArray(json.data) ? json.data : json.data?.items || [];
        const found = salesList.find(
          (s: any) =>
            s.invoiceNumber.toLowerCase() === q.toLowerCase() || s.id === q,
        );

        if (!found) {
          setSearchError(strings.pos.invoiceNotFound);
          return;
        }

        // Fetch full sale detail
        const detailRes = await apiFetch(`/sales/${found.id}`);
        if (!detailRes.ok) {
          setSearchError(strings.pos.searchInvoiceFailed);
          return;
        }

        const detailJson = await detailRes.json();
        const saleData = detailJson.data;

        if (saleData.status === "voided") {
          setSearchError(strings.pos.saleVoidedNoReturn);
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
        const lines: ReturnLineItem[] = saleData.items.map((it: any) => {
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
          strings.common.networkError,
        );
      } finally {
        setSearching(false);
      }
    },
    [apiFetch, invoiceQuery, locale],
  );

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

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
    const unitTotal = l.soldQty > 0 ? l.totalMinor / l.soldQty : 0;
    return sum + Math.round(unitTotal * l.selectedQty);
  }, 0);

  // Submit direct return
  const handleConfirmDirectReturn = async () => {
    if (!sale) return;
    const selected = returnLines.filter((l) => l.selectedQty > 0);
    if (selected.length === 0) {
      setSubmitError(strings.pos.selectAtLeastOneReturnItem);
      return;
    }

    if (isOutsideWindow) {
      if (!overrideReason.trim() || overrideReason.trim().length < 3) {
        setSubmitError(strings.pos.reasonRequiredPrompt);
        return;
      }
    }

    // Check drawer cash for cash refund
    if (drawerCashMinor > 0 && refundMethod === "cash" && estimatedRefundMinor > drawerCashMinor) {
      setSubmitError(
        `${strings.pos.cashDrawerInsufficient} (${strings.pos.drawerCashLabel}: ${formatMoney(drawerCashMinor)}, ${strings.pos.itemTotal}: ${formatMoney(estimatedRefundMinor)})`,
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
            strings.pos.returnFailed,
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
        strings.common.networkError,
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
        strings.pos.selectAtLeastOneReturnItem,
      );
      return;
    }

    if (isOutsideWindow && (!overrideReason.trim() || overrideReason.trim().length < 3)) {
      setSubmitError(
        strings.pos.reasonRequiredPrompt,
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
      <DialogContent data-testid="return-dialog" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            {completedReturn
              ? strings.pos.returnReceiptTitle
              : strings.pos.salesReturnExchangeTitle}
          </DialogTitle>
        </DialogHeader>

        {/* 1. Success Receipt View */}
        {completedReturn ? (
          <ReturnReceiptView
            completedReturn={completedReturn}
            onClose={() => {
              onClose();
              resetState();
            }}
          />
        ) : (
          /* 2. Interactive Return / Exchange Flow */
          <div className="space-y-5">
            {/* Invoice Search Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                <Input
                  data-testid="return-invoice-input"
                  placeholder={strings.pos.enterInvoiceToReturn}
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
                data-testid="search-invoice-button"
                onClick={() => handleSearchInvoice()}
                disabled={searching || !invoiceQuery.trim()}
              >
                {searching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  strings.pos.searchButton
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
                        {strings.pos.returnWindowExceeded}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="font-mono">
                      {strings.pos.originalTotal}{" "}
                      {formatMoney(sale.totalMinor)}
                    </Badge>
                  </div>
                </div>

                {/* Return window override reason input */}
                {isOutsideWindow && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-1.5">
                    <label className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {strings.pos.reasonRequiredPrompt}
                    </label>
                    <Input
                      placeholder={strings.pos.reasonPlaceholder}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="bg-white dark:bg-neutral-900 text-xs"
                    />
                  </div>
                )}

                {/* Items selection table */}
                <ReturnLinesTable
                  lines={returnLines}
                  onUpdateQty={updateLineQty}
                  onUpdateCondition={updateLineCondition}
                />

                {/* Common Reason and Refund Method for Direct Return */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
                      {strings.pos.returnReasonLabel}
                    </label>
                    <Input
                      data-testid="return-reason-input"
                      placeholder={strings.pos.reasonPlaceholder}
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
                      {strings.pos.refundMethodLabel}
                    </label>
                    <Select value={refundMethod} onValueChange={setRefundMethod}>
                      <SelectTrigger className="text-xs" data-testid="refund-method-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">
                          {formatPaymentMethod("cash", strings)} (
                          {strings.pos.drawerCashLabel}{" "}
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
                      {strings.pos.totalSelectedUnits}:
                    </span>
                    <span className="text-sm font-semibold">
                      {totalSelectedQty} {strings.common.units}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-neutral-500 block">
                      {strings.pos.estimatedRefund}:
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
                    data-testid="proceed-exchange-button"
                  >
                    <ArrowRight className="h-4 w-4 mr-2" />
                    {strings.pos.exchangeButton}
                  </Button>

                  <Button
                    type="button"
                    variant="default"
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={totalSelectedQty <= 0 || submitting}
                    onClick={handleConfirmDirectReturn}
                    data-testid="confirm-return-button"
                  >
                    {submitting ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-2" />
                    )}
                    {strings.pos.returnOnlyButton}
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
