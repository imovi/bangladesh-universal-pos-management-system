"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  RefreshCw,
  CreditCard,
  Scale,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { formatPaymentMethod, formatShiftStatus } from "@/i18n/formatters";

interface ShiftTransaction {
  type: string;
  id: string;
  inv?: string;
  amountMinor?: number;
  totalMinor?: number;
  reason?: string;
  at: string;
}

interface ShiftReportData {
  shiftId: string;
  registerName: string;
  cashierName: string;
  status: string;
  openingCashMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  cashSalesMinor: number;
  expectedCashMinor: number;
  closingCashMinor?: number | null;
  differenceMinor?: number | null;
  paymentMethodTotalsMinor?: Record<string, number>;
  bkashSalesMinor?: number;
  cardSalesMinor?: number;
  totalSalesCount: number;
  transactions: ShiftTransaction[];
}

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const shiftId = resolvedParams.id;

  const { apiFetch } = useAuth();
  const { strings } = useTranslation();

  const [report, setReport] = useState<ShiftReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchShiftReport = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await apiFetch(`/reports/shift/${shiftId}`);
      if (res.ok) {
        const json = await res.json();
        setReport(json.data);
      } else {
        setErrorMessage("Failed to load shift report");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, shiftId]);

  useEffect(() => {
    fetchShiftReport();
  }, [fetchShiftReport]);

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

  if (errorMessage || !report) {
    return (
      <div className="space-y-4">
        <Link href="/shifts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {strings.common.back}
          </Button>
        </Link>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage || "Shift not found"}
        </div>
      </div>
    );
  }

  const isOpen = report.status === "open";
  const diff = report.differenceMinor !== null && report.differenceMinor !== undefined ? report.differenceMinor : null;

  const paymentTotals = report.paymentMethodTotalsMinor || {
    cash: report.cashSalesMinor || 0,
    card: report.cardSalesMinor || 0,
    bkash: report.bkashSalesMinor || 0,
  };

  const totalSalesVolume = Object.values(paymentTotals).reduce((a, b) => a + Number(b), 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/shifts">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {strings.common.back}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {strings.shifts.shiftDetails}
              </h1>
              <Badge
                variant={isOpen ? "success" : "secondary"}
                className="text-xs"
              >
                {formatShiftStatus(report.status, strings)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Station: {report.registerName} • Cashier: {report.cashierName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            {strings.purchasing.print}
          </Button>
        </div>
      </div>

      {/* Cash Drawer Reconciliation Card */}
      <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            {strings.shifts.cashReconciliation}
          </h2>
          <span className="text-xs text-muted-foreground font-mono">
            ID: {report.shiftId.slice(0, 13)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-muted/30 border border-border">
            <span className="text-xs text-muted-foreground block">{strings.shifts.openingCash}</span>
            <span className="text-lg font-bold text-foreground block mt-1">
              {formatMoney(report.openingCashMinor)}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-muted/30 border border-border">
            <span className="text-xs text-muted-foreground block">{strings.shifts.netCashSales}</span>
            <span className="text-lg font-bold text-foreground block mt-1">
              +{formatMoney(report.cashSalesMinor)}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-muted/30 border border-border">
            <span className="text-xs text-muted-foreground block">
              {strings.shifts.cashIn} / {strings.shifts.cashOut}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-semibold text-emerald-600">
                +{formatMoney(report.cashInMinor)}
              </span>
              <span className="text-xs text-muted-foreground">/</span>
              <span className="text-sm font-semibold text-destructive">
                -{formatMoney(report.cashOutMinor)}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
            <span className="text-xs text-primary font-semibold block">{strings.shifts.expectedCash}</span>
            <span className="text-xl font-bold text-primary block mt-1">
              {formatMoney(report.expectedCashMinor)}
            </span>
          </div>
        </div>

        {/* Counted Cash & Discrepancy (if closed) */}
        {!isOpen && (
          <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-muted/40 border border-border">
              <span className="text-xs text-muted-foreground block">{strings.shifts.countedCash}</span>
              <span className="text-xl font-bold text-foreground block mt-1">
                {report.closingCashMinor !== null && report.closingCashMinor !== undefined
                  ? formatMoney(report.closingCashMinor)
                  : "-"}
              </span>
            </div>

            <div
              className={`p-4 rounded-xl border ${
                diff === 0
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                  : diff && diff < 0
                  ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400"
              }`}
            >
              <span className="text-xs font-semibold block">{strings.shifts.difference}</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl font-bold">
                  {diff !== null
                    ? diff > 0
                      ? `+${formatMoney(diff)}`
                      : formatMoney(diff)
                    : "-"}
                </span>
                <span className="text-xs font-medium">
                  {diff === 0
                    ? `(${strings.shifts.balanced})`
                    : diff && diff < 0
                    ? `(${strings.shifts.shortage})`
                    : `(${strings.shifts.overage})`}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sales by Payment Method Card (Fix 5 Figures) */}
      <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {strings.shifts.paymentMethodsBreakdown}
          </h2>
          <div className="text-right">
            <span className="text-xs text-muted-foreground block">
              {strings.sales.total} ({report.totalSalesCount})
            </span>
            <span className="text-base font-bold text-foreground">
              {formatMoney(totalSalesVolume)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(paymentTotals).map(([method, amountMinor]) => (
            <div key={method} className="p-3.5 rounded-xl bg-muted/40 border border-border text-center">
              <span className="text-xs font-semibold text-muted-foreground block mb-1">
                {formatPaymentMethod(method, strings)}
              </span>
              <span className="text-sm font-semibold text-foreground font-mono tabular-nums">
                {formatMoney(Number(amountMinor))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chronological Transactions Log */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {strings.shifts.transactionsLog}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs">
              <tr>
                <th className="py-2.5 px-4">{strings.shifts.time}</th>
                <th className="py-2.5 px-4">{strings.shifts.type}</th>
                <th className="py-2.5 px-4">{strings.sales.receiptNumber} / ID</th>
                <th className="py-2.5 px-4">{strings.shifts.reason}</th>
                <th className="py-2.5 px-4 text-right">{strings.shifts.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    {strings.common.noData}
                  </td>
                </tr>
              ) : (
                report.transactions.map((tx, idx) => {
                  const isSale = tx.type === "sale";
                  const isCashIn = tx.type === "cash_in";
                  const isCashOut = tx.type === "cash_out";
                  const amt = tx.totalMinor !== undefined ? tx.totalMinor : (tx.amountMinor || 0);

                  return (
                    <tr key={tx.id || idx} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(tx.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={`text-xs uppercase font-mono ${
                            isSale
                              ? "bg-blue-500/10 text-blue-600 border-blue-200"
                              : isCashIn
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                              : "bg-red-500/10 text-red-600 border-red-200"
                          }`}
                        >
                          {tx.type.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">
                        {isSale && tx.id ? (
                          <Link href={`/sales/${tx.id}`} className="hover:underline text-primary">
                            {tx.inv || tx.id.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{tx.id.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-foreground">
                        {tx.reason || (isSale ? "Customer Sale" : "-")}
                      </td>
                      <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                        <span
                          className={
                            isCashOut
                              ? "text-destructive"
                              : isCashIn || isSale
                              ? "text-emerald-600"
                              : "text-foreground"
                          }
                        >
                          {isCashOut ? `-${formatMoney(amt)}` : `+${formatMoney(amt)}`}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
