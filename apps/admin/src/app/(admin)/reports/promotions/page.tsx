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
  Tag,
  Download,
  ShoppingBag,
  TrendingUp,
  RotateCcw,
  Percent,
  RefreshCw,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { PermissionGate } from "@/components/common/permission-gate";

type DatePreset = "today" | "yesterday" | "last7days" | "thisMonth" | "custom";

interface PromotionReportResponse {
  summary: {
    totalSalesCount: number;
    totalUnitsSold: number;
    totalGrossMinor: number;
    totalDiscountGivenMinor: number;
    totalNetMinor: number;
    totalReturnUnits: number;
    totalReturnRefundMinor: number;
    netAfterReturnsMinor: number;
  };
  items: Array<{
    promotionId: string;
    name: string;
    type: string;
    salesCount: number;
    unitsSold: number;
    grossMinor: number;
    discountGivenMinor: number;
    netMinor: number;
    returnUnits: number;
    returnRefundMinor: number;
    netAfterReturnsMinor: number;
  }>;
  daily: Array<{
    date: string;
    salesCount: number;
    unitsSold: number;
    grossMinor: number;
    discountGivenMinor: number;
    netMinor: number;
  }>;
}

export default function PromotionsReportPage() {
  const { currentBranch, apiFetch } = useAuth();
  const { strings } = useTranslation();

  const [datePreset, setDatePreset] = useState<DatePreset>("thisMonth");
  const branchId = currentBranch?.id;

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

  const [startDate, setStartDate] = useState(computedStartDate);
  const [endDate, setEndDate] = useState(computedEndDate);

  React.useEffect(() => {
    if (datePreset !== "custom") {
      setStartDate(computedStartDate);
      setEndDate(computedEndDate);
    }
  }, [datePreset, computedStartDate, computedEndDate]);

  const { data, isLoading, refetch } = useQuery<PromotionReportResponse>({
    queryKey: ["reports-promotions", branchId, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId) params.append("branchId", branchId);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const res = await apiFetch(`/reports/promotions?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load promotion report");
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  const handleExportCsv = () => {
    if (!data || !data.items || data.items.length === 0) return;

    const headers = [
      strings.reports.offerName,
      strings.reports.offerType,
      strings.reports.salesCount,
      strings.reports.unitsSold,
      strings.reports.totalGross,
      strings.reports.discountGiven,
      strings.reports.netRevenue,
      strings.reports.unitsReturned,
      strings.reports.returnsOnPromoted,
      strings.reports.netAfterReturns,
    ];

    const rows = data.items.map((i) => [
      i.name,
      i.type,
      String(i.salesCount),
      String(i.unitsSold),
      (i.grossMinor / 100).toFixed(2),
      (i.discountGivenMinor / 100).toFixed(2),
      (i.netMinor / 100).toFixed(2),
      String(i.returnUnits),
      (i.returnRefundMinor / 100).toFixed(2),
      (i.netAfterReturnsMinor / 100).toFixed(2),
    ]);

    exportToCsv(`promotions-report-${startDate}-to-${endDate}.csv`, headers, rows);
  };

  const summary = data?.summary;
  const items = data?.items || [];
  const daily = data?.daily || [];

  return (
    <PermissionGate permission="report.sales">
      <div className="space-y-6">
        {/* Header & Filter Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Tag className="h-6 w-6 text-primary" />
              {strings.reports.promotionsTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {strings.reports.promotionsSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-muted p-1 rounded-lg text-xs">
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

            {datePreset === "custom" && (
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={({ startDate: s, endDate: e }) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
              />
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isLoading || items.length === 0}
              data-testid="export-promotions-csv"
              className="h-9"
            >
              <Download className="h-4 w-4 mr-2" />
              {strings.reports.exportCsv}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isLoading}
              className="h-9 w-9"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border border-border/60 shadow-sm" data-testid="kpi-promoted-sales">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.promotedSales}
              </CardTitle>
              <ShoppingBag className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">
                {summary ? summary.totalSalesCount : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {summary ? `${summary.totalUnitsSold} ${strings.reports.unitsSold.toLowerCase()}` : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-discount-given">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.discountGiven}
              </CardTitle>
              <Percent className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-emerald-600">
                {summary ? formatMoney(summary.totalDiscountGivenMinor) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary ? `${strings.reports.totalGross}: ${formatMoney(summary.totalGrossMinor)}` : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-promoted-returns">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.returnsOnPromoted}
              </CardTitle>
              <RotateCcw className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-destructive">
                {summary ? formatMoney(summary.totalReturnRefundMinor) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {summary ? `${summary.totalReturnUnits} ${strings.reports.unitsReturned.toLowerCase()}` : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-net-after-returns">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.netAfterReturns}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-blue-600">
                {summary ? formatMoney(summary.netAfterReturnsMinor) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary ? `${strings.reports.netRevenue}: ${formatMoney(summary.totalNetMinor)}` : ""}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabular Performance Table */}
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="border-b border-border/40 pb-3">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span>{strings.reports.promotionsTitle}</span>
              <span className="text-xs font-normal text-muted-foreground font-mono">
                ({items.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left" data-testid="promotions-report-table">
                <thead className="bg-muted/50 border-b border-border font-medium text-muted-foreground uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-4">{strings.reports.offerName}</th>
                    <th className="py-3 px-4">{strings.reports.offerType}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.salesCount}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.unitsSold}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.totalGross}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.discountGiven}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.netRevenue}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.returnsOnPromoted}</th>
                    <th className="py-3 px-4 text-right">{strings.reports.netAfterReturns}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                        {strings.common.loading}
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-muted-foreground">
                        {strings.reports.noDataForPeriod}
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.promotionId} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium text-foreground">
                          {item.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                          {item.type}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {item.salesCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {item.unitsSold}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatMoney(item.grossMinor)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-600">
                          {formatMoney(item.discountGivenMinor)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatMoney(item.netMinor)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-destructive">
                          {item.returnUnits > 0 ? (
                            <span>{formatMoney(item.returnRefundMinor)} ({item.returnUnits})</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                          {formatMoney(item.netAfterReturnsMinor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Daily Breakdown */}
        {daily.length > 0 && (
          <Card className="border border-border/60 shadow-sm">
            <CardHeader className="border-b border-border/40 pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {strings.reports.dailyBreakdown}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 border-b border-border font-medium text-muted-foreground uppercase text-[11px]">
                    <tr>
                      <th className="py-2.5 px-4">{strings.reports.custom}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.salesCount}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.unitsSold}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.totalGross}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.discountGiven}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.netRevenue}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {daily.map((d) => (
                      <tr key={d.date} className="hover:bg-muted/30">
                        <td className="py-2.5 px-4 font-mono font-medium">{d.date}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{d.salesCount}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{d.unitsSold}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatMoney(d.grossMinor)}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-emerald-600 font-semibold">{formatMoney(d.discountGivenMinor)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold">{formatMoney(d.netMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PermissionGate>
  );
}
