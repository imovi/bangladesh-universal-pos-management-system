"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  Ban,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface SalePayment {
  id: string;
  paymentMethod: string;
  amountMinor: number;
  reference?: string | null;
}

interface SaleItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  variant?: {
    id: string;
    sku: string;
    product?: {
      id: string;
      name: string;
    } | null;
  } | null;
}

interface SaleDetail {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotalMinor: number;
  totalDiscountMinor: number;
  taxAmountMinor: number;
  totalMinor: number;
  changeMinor?: number | null;
  notes?: string | null;
  voidReason?: string | null;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
    address?: string | null;
  } | null;
  cashierUser?: {
    id: string;
    name: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
  } | null;
  shift?: {
    id: string;
    status: string;
  } | null;
  items: SaleItem[];
  payments: SalePayment[];
}

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const saleId = resolvedParams.id;

  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Void modal state
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState(false);

  const fetchSale = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await apiFetch(`/sales/${saleId}`);
      if (res.ok) {
        const json = await res.json();
        setSale(json.data);
      } else {
        setErrorMessage("Failed to load sale details");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, saleId]);

  useEffect(() => {
    fetchSale();
  }, [fetchSale]);

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidReason.trim() || voidReason.trim().length < 3) {
      setVoidError(strings.sales.voidReasonRequired);
      return;
    }

    try {
      setVoidLoading(true);
      setVoidError(null);
      const res = await apiFetch(`/sales/${saleId}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: voidReason.trim() }),
      });

      if (res.ok) {
        setVoidSuccess(true);
        setTimeout(() => {
          setShowVoidModal(false);
          setVoidSuccess(false);
          fetchSale();
        }, 1000);
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (errJson.error?.code === "SHIFT_CLOSED" || res.status === 409) {
          setVoidError(strings.sales.shiftClosedError);
        } else if (res.status === 403) {
          setVoidError(strings.sales.voidForbidden);
        } else {
          setVoidError(errJson.message || errJson.error?.message || "Failed to void sale");
        }
      }
    } catch {
      setVoidError("Network error occurred");
    } finally {
      setVoidLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
      </div>
    );
  }

  if (errorMessage || !sale) {
    return (
      <div className="space-y-4">
        <Link href="/sales">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {strings.common.back}
          </Button>
        </Link>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage || "Sale not found"}
        </div>
      </div>
    );
  }

  const isVoided = sale.status === "voided";
  const canVoid = hasPermission("sale.void") && !isVoided;

  return (
    <div className="space-y-6">
      {/* Top Bar with Navigation & Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/sales">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {strings.common.back}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
                {sale.invoiceNumber}
              </h1>
              <Badge
                variant={isVoided ? "destructive" : "default"}
                className={`text-xs font-normal ${
                  isVoided
                    ? "bg-red-500/10 text-red-600 border-red-200 dark:border-red-800"
                    : "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-800"
                }`}
              >
                {isVoided ? strings.sales.statusVoided : strings.sales.statusCompleted}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(sale.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            {strings.sales.printReceipt}
          </Button>

          {canVoid && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setVoidReason("");
                setVoidError(null);
                setShowVoidModal(true);
              }}
            >
              <Ban className="h-4 w-4 mr-1.5" />
              {strings.sales.voidSale}
            </Button>
          )}
        </div>
      </div>

      {/* Void Notice if Voided */}
      {isVoided && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">{strings.sales.statusVoided}</p>
            {sale.voidReason && (
              <p className="text-xs mt-1 text-destructive/90">
                <span className="font-medium">{strings.sales.voidReason}:</span> {sale.voidReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main Grid: Details + Receipt Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Details & Items */}
        <div className="lg:col-span-2 space-y-6">
          {/* Metadata Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
              {strings.sales.saleDetails}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">{strings.sales.customer}</span>
                {sale.customer ? (
                  <div className="mt-1">
                    <span className="font-medium text-foreground block">{sale.customer.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{sale.customer.phone}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground italic text-xs mt-1 block">Walk-in Customer</span>
                )}
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">{strings.sales.cashier}</span>
                <span className="font-medium text-foreground block mt-1">
                  {sale.cashierUser?.name || "Counter Cashier"}
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">{strings.sales.branch}</span>
                <span className="font-medium text-foreground block mt-1">
                  {sale.branch?.name || "Main Counter"}
                </span>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                {strings.sales.lineItems}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs">
                  <tr>
                    <th className="py-2.5 px-4">{strings.sales.item}</th>
                    <th className="py-2.5 px-3 text-center">{strings.sales.qty}</th>
                    <th className="py-2.5 px-3 text-right">{strings.sales.chargedPrice}</th>
                    <th className="py-2.5 px-3 text-right">{strings.sales.discount}</th>
                    <th className="py-2.5 px-3 text-right">{strings.sales.tax}</th>
                    <th className="py-2.5 px-4 text-right">{strings.sales.total}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sale.items.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {it.variant?.product?.name || "Product"}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {it.variant?.sku || it.variantId}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center font-medium">
                        {it.quantity}
                      </td>
                      <td className="py-3 px-3 text-right text-muted-foreground">
                        {formatMoney(it.unitPriceMinor)}
                      </td>
                      <td className="py-3 px-3 text-right text-muted-foreground">
                        {it.discountMinor > 0 ? formatMoney(it.discountMinor) : "-"}
                      </td>
                      <td className="py-3 px-3 text-right text-muted-foreground">
                        {it.taxMinor > 0 ? formatMoney(it.taxMinor) : "-"}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-foreground">
                        {formatMoney(it.totalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payments List */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
              {strings.sales.payments}
            </h2>
            <div className="space-y-2">
              {sale.payments.map((p, idx) => (
                <div
                  key={p.id || idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase font-mono text-xs">
                      {p.paymentMethod}
                    </Badge>
                    {p.reference && (
                      <span className="text-xs text-muted-foreground font-mono">
                        Ref: {p.reference}
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-foreground">{formatMoney(p.amountMinor)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Receipt & Financial Summary */}
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-xs space-y-3">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
              {strings.sales.subtotal} & {strings.sales.total}
            </h2>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{strings.sales.subtotal}</span>
              <span>{formatMoney(sale.subtotalMinor || sale.totalMinor)}</span>
            </div>

            {sale.totalDiscountMinor > 0 && (
              <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                <span>{strings.sales.discount}</span>
                <span>-{formatMoney(sale.totalDiscountMinor)}</span>
              </div>
            )}

            {sale.taxAmountMinor > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{strings.sales.tax}</span>
                <span>+{formatMoney(sale.taxAmountMinor)}</span>
              </div>
            )}

            <div className="pt-3 border-t border-border flex justify-between text-base font-bold text-foreground">
              <span>{strings.sales.netTotal}</span>
              <span className={isVoided ? "line-through text-muted-foreground" : "text-primary"}>
                {formatMoney(sale.totalMinor)}
              </span>
            </div>

            {sale.changeMinor && sale.changeMinor > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground pt-1">
                <span>{strings.sales.changeAmount}</span>
                <span className="font-medium text-foreground">{formatMoney(sale.changeMinor)}</span>
              </div>
            )}
          </div>

          {/* Receipt Preview (Thermal 58/80mm layout) */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
              {strings.sales.receiptPreview}
            </h2>
            <div className="bg-muted/30 border border-dashed border-border p-4 rounded-lg font-mono text-xs text-foreground space-y-3 print:border-none print:p-0">
              {/* Store & Header */}
              <div className="text-center space-y-1">
                <p className="font-bold text-sm tracking-wider uppercase">
                  {sale.branch?.name || "UNIVERSAL POS STORE"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {sale.branch?.address || "Dhaka, Bangladesh"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Invoice: {sale.invoiceNumber}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Date: {new Date(sale.createdAt).toLocaleDateString()} {new Date(sale.createdAt).toLocaleTimeString()}
                </p>
              </div>

              <div className="border-t border-dashed border-border" />

              {/* Items List */}
              <div className="space-y-1.5">
                {sale.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="truncate max-w-[160px]">
                      {it.variant?.product?.name || "Item"} x{it.quantity}
                    </span>
                    <span>{formatMoney(it.totalMinor)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-border" />

              {/* Math */}
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatMoney(sale.subtotalMinor || sale.totalMinor)}</span>
                </div>
                {sale.totalDiscountMinor > 0 && (
                  <div className="flex justify-between">
                    <span>Discount:</span>
                    <span>-{formatMoney(sale.totalDiscountMinor)}</span>
                  </div>
                )}
                {sale.taxAmountMinor > 0 && (
                  <div className="flex justify-between">
                    <span>VAT / Tax:</span>
                    <span>+{formatMoney(sale.taxAmountMinor)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm pt-1 border-t border-border">
                  <span>TOTAL:</span>
                  <span>{formatMoney(sale.totalMinor)}</span>
                </div>
              </div>

              {/* Payments */}
              <div className="border-t border-dashed border-border pt-1 space-y-1">
                {sale.payments.map((p, idx) => (
                  <div key={idx} className="flex justify-between uppercase">
                    <span>Paid ({p.paymentMethod}):</span>
                    <span>{formatMoney(p.amountMinor)}</span>
                  </div>
                ))}
                {sale.changeMinor && sale.changeMinor > 0 ? (
                  <div className="flex justify-between">
                    <span>Change:</span>
                    <span>{formatMoney(sale.changeMinor)}</span>
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="text-center pt-2 text-[10px] text-muted-foreground border-t border-dashed border-border">
                <p>Thank you for shopping with us!</p>
                <p>Universal POS System</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Void Modal */}
      {showVoidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-6 w-6" />
              <h2 className="text-lg font-bold">{strings.sales.voidModalTitle}</h2>
            </div>

            <p className="text-xs text-muted-foreground">
              {strings.sales.voidWarning}
            </p>

            {voidSuccess ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {strings.sales.voidConfirmed}
              </div>
            ) : (
              <form onSubmit={handleVoid} className="space-y-4">
                {voidError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                    {voidError}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.sales.voidReason} *
                  </label>
                  <Input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. Customer returned items / Cashier error"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowVoidModal(false)}
                    disabled={voidLoading}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button type="submit" variant="destructive" disabled={voidLoading}>
                    {voidLoading ? strings.common.loading : strings.sales.voidButton}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
