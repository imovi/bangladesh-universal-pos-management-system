"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import {
  Download,
  Building2,
  Package,
  DollarSign,
  Search,
  RefreshCw,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface StockValuationItem {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCostMinor: number;
  valuationMinor: number;
}

interface StockValuationResponse {
  totalQty: number;
  totalValuationMinor: number;
  items: StockValuationItem[];
}

export default function StockValuationPage() {
  const { currentBranch, apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Branches
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await apiFetch("/branches");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Query Stock Valuation
  const {
    data: valuationData,
    isLoading,
    refetch,
  } = useQuery<StockValuationResponse>({
    queryKey: ["report-stock-valuation", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      const res = await apiFetch(`/reports/stock-valuation?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load valuation");
      const json = await res.json();
      return json.data || json;
    },
  });

  const allItems = valuationData?.items || [];
  const filteredItems = searchQuery.trim()
    ? allItems.filter(
        (it) =>
          it.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          it.sku.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allItems;

  const handleExportCsv = () => {
    if (!valuationData) return;
    const headers = [
      strings.reports.product,
      strings.reports.sku,
      strings.reports.stockUnits,
      `${strings.reports.unitCost} (BDT)`,
      `${strings.reports.valuation} (BDT)`,
    ];
    const rows = filteredItems.map((r) => [
      r.productName,
      r.sku,
      r.quantity,
      (r.unitCostMinor / 100).toFixed(2),
      (r.valuationMinor / 100).toFixed(2),
    ]);
    exportToCsv(`stock_valuation_${selectedBranchId || "all_branches"}`, headers, rows);
  };

  return (
    <div className="space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 rounded-xl bg-card border border-border shadow-sm">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {strings.reports.stockValuation}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {locale === "bn"
                ? "বর্তমান স্টকের পরিমাণ ও ক্রয়মূল্য ভিত্তিক আর্থিক মূল্যায়ন"
                : "Total in-stock valuation based on unit cost"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Branch Selector */}
            <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="bg-transparent font-medium focus:outline-none cursor-pointer"
                aria-label="Filter valuation by branch"
              >
                <option value="">{strings.common.allBranches}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="h-8 gap-1.5 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{strings.reports.exportCsv}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="h-8 px-2.5"
              aria-label="Refresh valuation"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Top Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.totalValuation}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {formatMoney(valuationData?.totalValuationMinor ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "ক্রয়মূল্যের ভিত্তিতে মোট ইনভেন্টরি সম্পদ" : "Cost basis inventory value"}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.totalQty}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Boxes className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">
                {valuationData?.totalQty ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {allItems.length} {locale === "bn" ? "টি ভ্যারিয়েন্ট স্টক স্তরে" : "tracked variants"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Valuation Table */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">
                {locale === "bn" ? "আইটেম ভিত্তিক স্টক মূল্যায়ন" : "Valuation by Item"}
              </CardTitle>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={strings.common.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-muted/50 border border-border focus:outline-none"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                {strings.common.loading}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {strings.common.noData}
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3 text-left font-medium">{strings.reports.product}</th>
                      <th className="py-2.5 px-3 text-left font-medium">{strings.reports.sku}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{strings.reports.stockUnits}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{strings.reports.unitCost}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{strings.reports.valuation}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredItems.map((item) => (
                      <tr key={item.variantId} className="hover:bg-muted/30">
                        <td className="py-2.5 px-3 font-medium text-foreground">{item.productName}</td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">{item.sku}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-foreground">{item.quantity}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">{formatMoney(item.unitCostMinor)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(item.valuationMinor)}
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
  );
}
