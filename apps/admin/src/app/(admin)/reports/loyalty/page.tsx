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
  Award,
  Download,
  Coins,
  TrendingUp,
  RotateCcw,
  RefreshCw,
  Users,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { PermissionGate } from "@/components/common/permission-gate";

type DatePreset = "today" | "yesterday" | "last7days" | "thisMonth" | "custom";

interface LoyaltyReportResponse {
  summary: {
    totalPointsIssued: number;
    totalPointsRedeemed: number;
    totalPointsExpired: number;
    totalPointsReversed: number;
    totalOutstandingPoints: number;
    liabilityMinor: number;
    pointValueMinor: number;
    earnRateMinor: number;
  };
  monthly: Array<{
    month: string;
    issued: number;
    redeemed: number;
    expired: number;
    reversed: number;
    netChange: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    phone: string;
    pointsBalance: number;
    liabilityMinor: number;
  }>;
}

export default function LoyaltyReportPage() {
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

  const { data, isLoading, refetch } = useQuery<LoyaltyReportResponse>({
    queryKey: ["reports-loyalty", branchId, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId) params.append("branchId", branchId);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const res = await apiFetch(`/reports/loyalty?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load loyalty report");
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  const handleExportCsv = () => {
    if (!data) return;

    // Monthly breakdown export
    const headers = [
      strings.reports.monthlyBreakdown,
      strings.reports.pointsIssued,
      strings.reports.pointsRedeemed,
      strings.reports.pointsExpired,
      strings.reports.pointsReversed,
      strings.reports.netPointsChange,
    ];

    const rows = (data.monthly || []).map((m) => [
      m.month,
      String(m.issued),
      String(m.redeemed),
      String(m.expired),
      String(m.reversed),
      String(m.netChange),
    ]);

    exportToCsv(`loyalty-report-monthly-${startDate}-to-${endDate}.csv`, headers, rows);
  };

  const summary = data?.summary;
  const monthly = data?.monthly || [];
  const topCustomers = data?.topCustomers || [];

  return (
    <PermissionGate permission="report.sales">
      <div className="space-y-6">
        {/* Header & Filter Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              {strings.reports.loyaltyTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {strings.reports.loyaltySubtitle}
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
              disabled={isLoading || monthly.length === 0}
              data-testid="export-loyalty-csv"
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

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border border-border/60 shadow-sm" data-testid="kpi-outstanding-points">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.outstandingPoints}
              </CardTitle>
              <Coins className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">
                {summary ? summary.totalOutstandingPoints.toLocaleString() : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {summary ? `1 pt = ${formatMoney(summary.pointValueMinor)}` : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-shop-liability">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.shopLiability}
              </CardTitle>
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-amber-600">
                {summary ? formatMoney(summary.liabilityMinor) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {strings.reports.outstandingPoints}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-points-issued">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.pointsIssued}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-emerald-600">
                {summary ? summary.totalPointsIssued.toLocaleString() : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {summary ? `Earn: ${formatMoney(summary.earnRateMinor)} = 1 pt` : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm" data-testid="kpi-points-redeemed">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {strings.reports.pointsRedeemed}
              </CardTitle>
              <RotateCcw className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-blue-600">
                {summary ? summary.totalPointsRedeemed.toLocaleString() : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {summary ? `${strings.reports.pointsExpired}: ${summary.totalPointsExpired.toLocaleString()}` : ""}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Top 10 Customers by Balance */}
        <Card className="border border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              {strings.reports.topCustomersByBalance}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                {strings.common.loading}
              </div>
            ) : topCustomers.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {strings.reports.noDataForPeriod}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse" data-testid="loyalty-top-customers-table">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <th className="py-2.5 px-4">{strings.reports.customerName}</th>
                      <th className="py-2.5 px-4">{strings.reports.phone}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.pointsBalance}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.liabilityValue}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {topCustomers.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/20">
                        <td className="py-2.5 px-4 font-medium text-foreground">{c.name}</td>
                        <td className="py-2.5 px-4 font-mono text-muted-foreground">{c.phone}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-primary">
                          {c.pointsBalance.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-amber-700 dark:text-amber-300">
                          {formatMoney(c.liabilityMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Breakdown Table */}
        <Card className="border border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              {strings.reports.monthlyBreakdown}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                {strings.common.loading}
              </div>
            ) : monthly.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {strings.reports.noDataForPeriod}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse" data-testid="loyalty-monthly-table">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <th className="py-2.5 px-4">{strings.reports.monthlyBreakdown}</th>
                      <th className="py-2.5 px-4 text-right text-emerald-600">{strings.reports.pointsIssued}</th>
                      <th className="py-2.5 px-4 text-right text-blue-600">{strings.reports.pointsRedeemed}</th>
                      <th className="py-2.5 px-4 text-right text-muted-foreground">{strings.reports.pointsExpired}</th>
                      <th className="py-2.5 px-4 text-right text-rose-600">{strings.reports.pointsReversed}</th>
                      <th className="py-2.5 px-4 text-right">{strings.reports.netPointsChange}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {monthly.map((m) => (
                      <tr key={m.month} className="hover:bg-muted/20">
                        <td className="py-2.5 px-4 font-mono font-medium text-foreground">{m.month}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-emerald-600">
                          +{m.issued.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-blue-600">
                          -{m.redeemed.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                          {m.expired > 0 ? `-${m.expired.toLocaleString()}` : "0"}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-rose-600">
                          {m.reversed > 0 ? `-${m.reversed.toLocaleString()}` : "0"}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-mono font-bold ${m.netChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {m.netChange >= 0 ? `+${m.netChange.toLocaleString()}` : m.netChange.toLocaleString()}
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
    </PermissionGate>
  );
}
