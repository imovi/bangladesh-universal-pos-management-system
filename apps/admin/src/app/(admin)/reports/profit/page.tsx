"use client";

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import { formatBusinessDate } from "@universal-pos/shared";
import {
  DollarSign,
  Download,
  Building2,
  TrendingUp,
  ShieldAlert,
  Percent,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type DatePreset = "today" | "yesterday" | "last7days" | "thisMonth" | "custom";

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface ProfitReportResponse {
  revenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  profitMarginBp: number;
}

export default function ProfitReportPage() {
  const { currentBranch, hasPermission, apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const [datePreset, setDatePreset] = useState<DatePreset>("thisMonth");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");

  const todayStr = useMemo(() => formatBusinessDate(new Date(), "Asia/Dhaka"), []);

  const { computedStartDate, computedEndDate } = useMemo(() => {
    const now = new Date();
    if (datePreset === "today") {
      return { computedStartDate: todayStr, computedEndDate: todayStr };
    }
    if (datePreset === "yesterday") {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = formatBusinessDate(y, "Asia/Dhaka");
      return { computedStartDate: yStr, computedEndDate: yStr };
    }
    if (datePreset === "last7days") {
      const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      return {
        computedStartDate: formatBusinessDate(past, "Asia/Dhaka"),
        computedEndDate: todayStr,
      };
    }
    if (datePreset === "thisMonth") {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      return {
        computedStartDate: `${year}-${month}-01`,
        computedEndDate: todayStr,
      };
    }
    return { computedStartDate: todayStr, computedEndDate: todayStr };
  }, [datePreset, todayStr]);

  const [customStart, setCustomStart] = useState<string>(computedStartDate);
  const [customEnd, setCustomEnd] = useState<string>(computedEndDate);

  const effectiveStartDate = datePreset === "custom" ? customStart : computedStartDate;
  const effectiveEndDate = datePreset === "custom" ? customEnd : computedEndDate;

  // Permission Gate: report.profit
  const canViewProfit = hasPermission("report.profit");

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

  // Query Profit
  const {
    data: profitData,
    isLoading,
    refetch,
  } = useQuery<ProfitReportResponse>({
    queryKey: ["report-profit", effectiveStartDate, effectiveEndDate, selectedBranchId],
    enabled: canViewProfit,
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      const res = await apiFetch(`/reports/profit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load profit report");
      const json = await res.json();
      return json.data || json;
    },
  });

  const handleExportCsv = () => {
    if (!profitData) return;
    const dateRangeSuffix = `${effectiveStartDate}_to_${effectiveEndDate}`;
    const headers = ["Item", "Amount / Percentage"];
    const rows = [
      [strings.reports.revenue, (profitData.revenueMinor / 100).toFixed(2)],
      [strings.reports.cogs, (profitData.cogsMinor / 100).toFixed(2)],
      [strings.reports.grossProfit, (profitData.grossProfitMinor / 100).toFixed(2)],
      [strings.reports.profitMargin, `${(profitData.profitMarginBp / 100).toFixed(2)}%`],
    ];
    exportToCsv(`profit_report_${dateRangeSuffix}`, headers, rows);
  };

  if (!canViewProfit) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <div className="h-14 w-14 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">{strings.access.deniedTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.access.deniedMessage}</p>
        <div className="pt-2">
          <Link href="/dashboard">
            <Button variant="outline">{strings.access.backToHome}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const revenueMinor = profitData?.revenueMinor ?? 0;
  const cogsMinor = profitData?.cogsMinor ?? 0;
  const grossProfitMinor = profitData?.grossProfitMinor ?? 0;
  const marginPercent = profitData ? (profitData.profitMarginBp / 100).toFixed(2) : "0.00";

  return (
    <div className="space-y-6">
        {/* Header Bar */}
        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                {strings.reports.profitReport}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {strings.reports.profitHelp}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                aria-label="Refresh profit report"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            {/* Presets */}
            <div className="flex flex-wrap items-center gap-1.5 bg-muted/60 p-1 rounded-lg border border-border text-xs">
              {(
                [
                  { id: "today", label: strings.reports.today },
                  { id: "yesterday", label: strings.reports.yesterday },
                  { id: "last7days", label: strings.reports.last7Days },
                  { id: "thisMonth", label: strings.reports.thisMonth },
                  { id: "custom", label: strings.reports.custom },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setDatePreset(preset.id)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                    datePreset === preset.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Range & Branch */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {datePreset === "custom" && (
                <div className="flex items-center gap-2 bg-muted/40 p-1.5 rounded-lg border border-border">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="bg-transparent font-medium focus:outline-none cursor-pointer"
                  />
                  <span>-</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="bg-transparent font-medium focus:outline-none cursor-pointer"
                  />
                </div>
              )}

              {/* Branch */}
              <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="bg-transparent font-medium focus:outline-none cursor-pointer"
                  aria-label="Filter profit by branch"
                >
                  <option value="">{strings.common.allBranches}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.revenue}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-foreground" data-testid="profit-revenue">
                {formatMoney(revenueMinor)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "নিট মোট বিক্রয় আয়" : "Net sales revenue"}
              </p>
            </CardContent>
          </Card>

          {/* COGS */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.cogs}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400" data-testid="profit-cogs">
                {formatMoney(cogsMinor)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "বিক্রিত পণ্যের ক্রয়মূল্য" : "Cost basis of sold inventory"}
              </p>
            </CardContent>
          </Card>

          {/* Gross Profit */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.grossProfit}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold tracking-tight ${
                  grossProfitMinor >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
                data-testid="profit-gross-profit"
              >
                {formatMoney(grossProfitMinor)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "মোট গ্রস লাভ (আয় - ব্যয়)" : "Revenue minus COGS"}
              </p>
            </CardContent>
          </Card>

          {/* Gross Margin */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                {strings.reports.profitMargin}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Percent className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400" data-testid="profit-margin">
                {marginPercent}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "মোট আয়ের শতাংশে লাভ" : "Gross profit margin percentage"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Visual Revenue Structure & Table */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-sm font-semibold">
              {locale === "bn" ? "আর্থিক কাঠামো বিশ্লেষণ" : "Financial Statement Analysis"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                {strings.common.loading}
              </div>
            ) : revenueMinor > 0 ? (
              <>
                {/* Proportional Margin Bar */}
                <div
                  className="h-4 w-full bg-muted rounded-full overflow-hidden flex border border-border"
                  role="progressbar"
                  aria-label="Profit breakdown"
                  aria-valuenow={100}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    style={{ width: `${Math.max(0, Math.min(100, (cogsMinor / revenueMinor) * 100))}%` }}
                    className="bg-amber-500 h-full transition-all"
                    title={`COGS: ${((cogsMinor / revenueMinor) * 100).toFixed(1)}%`}
                  />
                  <div
                    style={{ width: `${Math.max(0, Math.min(100, (grossProfitMinor / revenueMinor) * 100))}%` }}
                    className="bg-emerald-500 h-full transition-all"
                    title={`Gross Profit: ${((grossProfitMinor / revenueMinor) * 100).toFixed(1)}%`}
                  />
                </div>

                {/* Statement Table */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2.5 px-3 text-left font-medium">{locale === "bn" ? "বিবরণ" : "Line Item"}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{locale === "bn" ? "পরিমাণ (টাকা)" : "Amount (BDT)"}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{locale === "bn" ? "অনুপাত (%)" : "Ratio (%)"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="py-2.5 px-3 font-semibold text-foreground">
                          {strings.reports.revenue}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-foreground">
                          {formatMoney(revenueMinor)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">100.0%</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          (-) {strings.reports.cogs}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                          {formatMoney(cogsMinor)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                          {((cogsMinor / revenueMinor) * 100).toFixed(1)}%
                        </td>
                      </tr>
                      <tr className="bg-muted/20">
                        <td className="py-2.5 px-3 font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          (=) {strings.reports.grossProfit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(grossProfitMinor)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {marginPercent}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground">
                {strings.reports.noDataForPeriod}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
