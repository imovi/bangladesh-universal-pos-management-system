"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { formatBusinessDate } from "@universal-pos/shared";
import { formatPaymentMethod } from "@/i18n/formatters";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Clock,
  TrendingUp,
  Package,
  CreditCard,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface SalesSummaryResponse {
  salesCount: number;
  totalGrossMinor: number;
  totalDiscountMinor: number;
  totalTaxMinor: number;
  totalNetMinor: number;
  paymentsByMethod: Record<string, number>;
}

interface VariantSaleItem {
  variantId: string;
  sku: string;
  productId?: string;
  productName: string;
  variantName?: string | null;
  quantitySold: number;
  revenueMinor: number;
  averagePriceMinor: number;
}

export default function DashboardPage() {
  const { currentBranch, apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const todayStr = formatBusinessDate(new Date(), "Asia/Dhaka");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const selectedBranchId = currentBranch?.id || "";

  // Query Sales Summary
  const { data: salesSummary, isLoading: isSummaryLoading, refetch: refetchSummary } = useQuery<SalesSummaryResponse>({
    queryKey: ["dashboard-sales-summary", selectedDate, selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDate) {
        params.set("startDate", selectedDate);
        params.set("endDate", selectedDate);
      }
      if (selectedBranchId) {
        params.set("branchId", selectedBranchId);
      }
      const res = await apiFetch(`/reports/sales-summary?${params.toString()}`);
      if (!res.ok) {
        return {
          salesCount: 0,
          totalGrossMinor: 0,
          totalDiscountMinor: 0,
          totalTaxMinor: 0,
          totalNetMinor: 0,
          paymentsByMethod: {},
        };
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  // Query Best Selling Items
  const { data: variantSales = [] } = useQuery<VariantSaleItem[]>({
    queryKey: ["dashboard-variant-sales", selectedDate, selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDate) {
        params.set("startDate", selectedDate);
        params.set("endDate", selectedDate);
      }
      if (selectedBranchId) {
        params.set("branchId", selectedBranchId);
      }
      const res = await apiFetch(`/reports/sales-by-variant?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      const list: VariantSaleItem[] = Array.isArray(json) ? json : (json.data || []);
      return list.sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 10);
    },
  });

  // Query Low Stock Count
  const { data: lowStockCount = 0 } = useQuery<number>({
    queryKey: ["dashboard-low-stock", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams({ isLowStock: "true" });
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      const res = await apiFetch(`/inventory/stock-levels?${params.toString()}`);
      if (!res.ok) return 0;
      const json = await res.json();
      const data = json.data || json;
      return Array.isArray(data) ? data.length : (data.total ?? 0);
    },
  });

  // Query Open Shifts Count
  const { data: openShiftsCount = 0 } = useQuery<number>({
    queryKey: ["dashboard-open-shifts", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "open" });
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      const res = await apiFetch(`/shifts?${params.toString()}`);
      if (!res.ok) return 0;
      const json = await res.json();
      const list = json.data || json;
      return Array.isArray(list) ? list.length : (list.items?.length ?? 0);
    },
  });

  const salesCount = salesSummary?.salesCount ?? 0;
  const totalNetMinor = salesSummary?.totalNetMinor ?? 0;
  const avgSaleMinor = salesCount > 0 ? Math.round(totalNetMinor / salesCount) : 0;
  const payments = salesSummary?.paymentsByMethod ?? {};

  const paymentEntries = Object.entries(payments);
  const totalPaid = paymentEntries.reduce((sum, [, amount]) => sum + amount, 0);

  // Accessible color tokens for payment breakdown
  const barColors = [
    { bg: "bg-blue-600", hex: "#2563eb", pattern: "fill-blue" },
    { bg: "bg-emerald-600", hex: "#059669", pattern: "fill-emerald" },
    { bg: "bg-amber-600", hex: "#d97706", pattern: "fill-amber" },
    { bg: "bg-purple-600", hex: "#7c3aed", pattern: "fill-purple" },
    { bg: "bg-rose-600", hex: "#e11d48", pattern: "fill-rose" },
    { bg: "bg-cyan-600", hex: "#0891b2", pattern: "fill-cyan" },
  ];

  // Group best-selling items by product
  const groupedProducts = React.useMemo(() => {
    const map = new Map<string, { productName: string; totalQty: number; totalRevenue: number; variants: VariantSaleItem[] }>();
    for (const item of variantSales) {
      const key = item.productName;
      const existing = map.get(key) || {
        productName: item.productName,
        totalQty: 0,
        totalRevenue: 0,
        variants: [],
      };
      existing.totalQty += item.quantitySold;
      existing.totalRevenue += item.revenueMinor;
      existing.variants.push(item);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty).slice(0, 5);
  }, [variantSales]);

  return (
    <div className="space-y-6">
      {/* Header Bar: Title and Date Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl bg-card border border-border shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {locale === "bn" ? "দোকান ড্যাশবোর্ড" : "Store Dashboard"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {locale === "bn"
              ? "বাস্তব সময়ের বিক্রির হিসাব ও বিশ্লেষণ"
              : "Real-time sales figures and daily summary"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <DatePicker
            value={selectedDate}
            onChange={(d) => setSelectedDate(d)}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSummary()}
            disabled={isSummaryLoading}
            className="h-9 px-2.5"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className={`h-4 w-4 ${isSummaryLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Top KPI Cards Grid - Neutral grey icons, text-foreground amounts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Sales Total */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {strings.dashboard.todaySales}
            </CardTitle>
            <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums" data-testid="dashboard-total-sales">
              {formatMoney(totalNetMinor)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {salesCount > 0 ? `${salesCount} ${locale === "bn" ? "টি ভাউচার" : "sales"}` : strings.dashboard.noSalesToday}
            </p>
          </CardContent>
        </Card>

        {/* Sales Count */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {strings.dashboard.salesCount}
            </CardTitle>
            <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <ShoppingCart className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums" data-testid="dashboard-sales-count">
              {salesCount}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {locale === "bn" ? "মোট ভাউচার সংখ্যা" : "Completed receipts"}
            </p>
          </CardContent>
        </Card>

        {/* Average Basket */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {strings.dashboard.averageBasket}
            </CardTitle>
            <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums" data-testid="dashboard-avg-sale">
              {formatMoney(avgSaleMinor)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {locale === "bn" ? "প্রতি বিক্রিতে গড় আয়" : "Average sale amount"}
            </p>
          </CardContent>
        </Card>

        {/* Low Stock Items */}
        <Link href="/inventory/low-stock" className="block focus:outline-none">
          <Card className="shadow-sm hover:border-border transition-colors h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.lowStockAlerts}
              </CardTitle>
              <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums" data-testid="dashboard-low-stock-count">
                {lowStockCount}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {locale === "bn" ? "সীমার নিচে থাকা স্টক" : "Below reorder limit"}
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Active Shifts */}
        <Link href="/shifts" className="block focus:outline-none">
          <Card className="shadow-sm hover:border-border transition-colors h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.openShifts}
              </CardTitle>
              <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums" data-testid="dashboard-open-shifts-count">
                {openShiftsCount}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {locale === "bn" ? "সক্রিয় ক্যাশিয়ার শিফট" : "Open register sessions"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Section 2: Payment Method Split and Best Selling Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Method Split Card */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">
                {strings.reports.paymentsByMethod}
              </CardTitle>
            </div>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {locale === "bn" ? "মোট পরিশোধ:" : "Total Collected:"} {formatMoney(totalPaid)}
            </span>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {paymentEntries.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {locale === "bn" ? "আজকের কোনো পেমেন্ট রেকর্ড নেই" : "No payment collections recorded today"}
              </div>
            ) : (
              <>
                {/* Visual Accessible Proportional Bar with labels/patterns */}
                <div
                  className="h-4 w-full bg-muted rounded-full overflow-hidden flex border border-border"
                  role="progressbar"
                  aria-label="Payment method distribution"
                  aria-valuenow={100}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  {paymentEntries.map(([method, amount], idx) => {
                    const pct = totalPaid > 0 ? (amount / totalPaid) * 100 : 0;
                    const colorItem = barColors[idx % barColors.length];
                    const label = formatPaymentMethod(method, strings);
                    return (
                      <div
                        key={method}
                        style={{ width: `${pct}%` }}
                        className={`${colorItem.bg} h-full transition-all flex items-center justify-center text-[9px] font-bold text-white overflow-hidden`}
                        title={`${label}: ${pct.toFixed(1)}%`}
                      >
                        {pct >= 15 ? label : ""}
                      </div>
                    );
                  })}
                </div>

                {/* Accompanying Data Table: dot color matches bar segment */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2.5 px-3 text-left font-semibold">
                          {locale === "bn" ? "পদ্ধতি" : "Method"}
                        </th>
                        <th className="py-2.5 px-3 text-right font-semibold">
                          {locale === "bn" ? "পরিমাণ" : "Amount"}
                        </th>
                        <th className="py-2.5 px-3 text-right font-semibold">
                          {locale === "bn" ? "ভাগ" : "Share"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paymentEntries.map(([method, amount], idx) => {
                        const pct = totalPaid > 0 ? (amount / totalPaid) * 100 : 0;
                        const colorItem = barColors[idx % barColors.length];
                        const label = formatPaymentMethod(method, strings);
                        return (
                          <tr key={method} className="hover:bg-muted/30 h-[44px]">
                            <td className="py-2 px-3 font-medium flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${colorItem.bg} shrink-0`} />
                              <span>{label}</span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-foreground">
                              {formatMoney(amount)}
                            </td>
                            <td className="py-2 px-3 text-right text-muted-foreground font-mono tabular-nums">
                              {pct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Best Selling Items Card - Grouped by Product with Variants Underneath */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">
                {strings.dashboard.topSelling}
              </CardTitle>
            </div>
            <Link
              href="/reports/sales?tab=variant"
              className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            >
              <span>{strings.common.view}</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="pt-4">
            {groupedProducts.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {locale === "bn" ? "নির্বাচিত দিনে কোনো পণ্য বিক্রি হয়নি" : "No item sales recorded for this date"}
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3 text-left font-semibold">
                        {strings.reports.product}
                      </th>
                      <th className="py-2.5 px-3 text-right font-semibold">
                        {strings.reports.qtySold}
                      </th>
                      <th className="py-2.5 px-3 text-right font-semibold">
                        {strings.reports.revenue}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedProducts.map((grp) => (
                      <tr key={grp.productName} className="hover:bg-muted/30">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-foreground">
                            {grp.productName}
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {grp.variants.map((v) => (
                              <div key={v.variantId} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="font-mono text-[10px] bg-muted px-1 rounded">
                                  {v.sku}
                                </span>
                                <span>{v.variantName || "Standard"}</span>
                                <span className="text-muted-foreground/60">·</span>
                                <span className="font-mono tabular-nums">{v.quantitySold} {locale === "bn" ? "টি" : "sold"}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-foreground font-mono tabular-nums align-top pt-3">
                          {grp.totalQty}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-foreground font-mono tabular-nums align-top pt-3">
                          {formatMoney(grp.totalRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
