"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { formatBusinessDate } from "@universal-pos/shared";
import {
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Clock,
  TrendingUp,
  Package,
  CreditCard,
  Building2,
  Calendar,
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
  productName: string;
  quantitySold: number;
  revenueMinor: number;
  averagePriceMinor: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function DashboardPage() {
  const { currentBranch, apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const todayStr = formatBusinessDate(new Date(), "Asia/Dhaka");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");

  // Fetch branches
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await apiFetch("/branches");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

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
      return list.sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 5);
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

  const formatPaymentName = (method: string) => {
    switch (method.toLowerCase()) {
      case "cash": return locale === "bn" ? "নগদ (Cash)" : "Cash";
      case "card": return locale === "bn" ? "কার্ড (Card)" : "Card";
      case "bkash": return "bKash";
      case "nagad": return "Nagad";
      case "rocket": return "Rocket";
      case "bank_transfer": return locale === "bn" ? "ব্যাংক ট্রান্সফার" : "Bank Transfer";
      default: return method;
    }
  };

  return (
    <div className="space-y-6">
        {/* Controls Bar: Branch & Business Date Filter */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 rounded-xl bg-card border border-border shadow-sm">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {locale === "bn" ? "দোকান ড্যাশবোর্ড" : "Store Dashboard"}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {locale === "bn"
                ? "বাস্তব সময়ের বিক্রির হিসাব ও বিশ্লেষণ"
                : "Real-time sales figures and daily summary"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Branch Selector */}
            <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                aria-label="Filter by branch"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="bg-transparent font-medium focus:outline-none cursor-pointer"
              >
                <option value="">{strings.common.allBranches}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                aria-label="Business date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent font-medium focus:outline-none cursor-pointer"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchSummary()}
              disabled={isSummaryLoading}
              className="h-8 px-2.5"
              aria-label="Refresh dashboard data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSummaryLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Top KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Sales Total */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.todaySales}
              </CardTitle>
              <div className="h-7 w-7 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400" data-testid="dashboard-total-sales">
                {formatMoney(totalNetMinor)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
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
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <ShoppingCart className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="dashboard-sales-count">
                {salesCount}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
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
              <div className="h-7 w-7 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400" data-testid="dashboard-avg-sale">
                {formatMoney(avgSaleMinor)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {locale === "bn" ? "প্রতি বিক্রিতে গড় আয়" : "Average sale amount"}
              </p>
            </CardContent>
          </Card>

          {/* Low Stock Items */}
          <Link href="/inventory/low-stock" className="block focus:outline-none">
            <Card className="shadow-sm hover:border-amber-500/50 transition-colors h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {strings.dashboard.lowStockAlerts}
                </CardTitle>
                <div className="h-7 w-7 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400" data-testid="dashboard-low-stock-count">
                  {lowStockCount}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {locale === "bn" ? "সীমার নিচে থাকা স্টক" : "Below reorder limit"}
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Active Shifts */}
          <Link href="/shifts" className="block focus:outline-none">
            <Card className="shadow-sm hover:border-blue-500/50 transition-colors h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {strings.dashboard.openShifts}
                </CardTitle>
                <div className="h-7 w-7 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Clock className="h-3.5 w-3.5" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400" data-testid="dashboard-open-shifts-count">
                  {openShiftsCount}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
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
                <CardTitle className="text-sm font-semibold">
                  {strings.reports.paymentsByMethod}
                </CardTitle>
              </div>
              <span className="text-xs text-muted-foreground">
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
                  {/* Visual Accessible Proportional Bar */}
                  <div
                    className="h-3.5 w-full bg-muted rounded-full overflow-hidden flex border border-border"
                    role="progressbar"
                    aria-label="Payment method distribution"
                    aria-valuenow={100}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {paymentEntries.map(([method, amount], idx) => {
                      const pct = totalPaid > 0 ? (amount / totalPaid) * 100 : 0;
                      // Alternate contrasting accessible styling
                      const colors = [
                        "bg-emerald-500",
                        "bg-blue-500",
                        "bg-pink-500",
                        "bg-amber-500",
                        "bg-purple-500",
                        "bg-teal-500",
                      ];
                      return (
                        <div
                          key={method}
                          style={{ width: `${pct}%` }}
                          className={`${colors[idx % colors.length]} h-full transition-all`}
                          title={`${formatPaymentName(method)}: ${pct.toFixed(1)}%`}
                        />
                      );
                    })}
                  </div>

                  {/* Accompanying Data Table (accessible, exact numbers) */}
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="py-2 px-3 text-left font-medium">
                            {locale === "bn" ? "পদ্ধতি" : "Method"}
                          </th>
                          <th className="py-2 px-3 text-right font-medium">
                            {locale === "bn" ? "পরিমাণ" : "Amount"}
                          </th>
                          <th className="py-2 px-3 text-right font-medium">
                            {locale === "bn" ? "ভাগ (%)" : "Share (%)"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {paymentEntries.map(([method, amount]) => {
                          const pct = totalPaid > 0 ? (amount / totalPaid) * 100 : 0;
                          return (
                            <tr key={method} className="hover:bg-muted/30">
                              <td className="py-2 px-3 font-medium flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-primary" />
                                {formatPaymentName(method)}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold">
                                {formatMoney(amount)}
                              </td>
                              <td className="py-2 px-3 text-right text-muted-foreground font-mono">
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

          {/* Best Selling Items Card */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-semibold">
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
              {variantSales.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {locale === "bn" ? "নির্বাচিত দিনে কোনো পণ্য বিক্রি হয়নি" : "No item sales recorded for this date"}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">
                          {strings.reports.product}
                        </th>
                        <th className="py-2 px-3 text-right font-medium">
                          {strings.reports.qtySold}
                        </th>
                        <th className="py-2 px-3 text-right font-medium">
                          {strings.reports.revenue}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {variantSales.map((item) => (
                        <tr key={item.variantId} className="hover:bg-muted/30">
                          <td className="py-2 px-3">
                            <div className="font-medium text-foreground truncate max-w-[170px] sm:max-w-[240px]">
                              {item.productName}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              SKU: {item.sku}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-foreground">
                            {item.quantitySold}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(item.revenueMinor)}
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
