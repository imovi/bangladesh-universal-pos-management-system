"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import Link from "next/link";
import {
  DollarSign,
  Download,
  AlertTriangle,
  Clock,
  Users,
  RefreshCw,
  Building,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface CustomerDueBucket {
  customerId: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  totalDueMinor: number;
  bucket0to30Minor: number;
  bucket31to60Minor: number;
  bucket61to90Minor: number;
  bucketOver90Minor: number;
  oldestInvoiceDate: string;
  unpaidInvoicesCount: number;
}

interface DueReportData {
  summary: {
    totalDueMinor: number;
    bucket0to30Minor: number;
    bucket31to60Minor: number;
    bucket61to90Minor: number;
    bucketOver90Minor: number;
    customerCount: number;
    invoiceCount: number;
  };
  customers: CustomerDueBucket[];
}

export default function DueReportPage() {
  const { currentBranch, user, apiFetch } = useAuth();
  const branches = user?.branches || [];
  const { strings, locale } = useTranslation();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");

  const { data, isLoading, refetch, isRefetching } = useQuery<DueReportData>({
    queryKey: ["due-ageing-report", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);

      const res = await apiFetch(`/reports/due?${params.toString()}`);
      if (!res.ok) {
        return {
          summary: {
            totalDueMinor: 0,
            bucket0to30Minor: 0,
            bucket31to60Minor: 0,
            bucket61to90Minor: 0,
            bucketOver90Minor: 0,
            customerCount: 0,
            invoiceCount: 0,
          },
          customers: [],
        };
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  const handleExportCsv = () => {
    if (!data?.customers || data.customers.length === 0) return;

    const headers = [
      locale === "bn" ? "গ্রাহকের নাম" : "Customer Name",
      locale === "bn" ? "ফোন নম্বর" : "Phone",
      locale === "bn" ? "শাখা" : "Branch",
      locale === "bn" ? "মোট বাকি (টাকা)" : "Total Due (BDT)",
      locale === "bn" ? "০-৩০ দিন" : "0-30 Days",
      locale === "bn" ? "৩১-৬০ দিন" : "31-60 Days",
      locale === "bn" ? "৬১-৯০ দিন" : "61-90 Days",
      locale === "bn" ? ">৯০ দিন" : ">90 Days",
      locale === "bn" ? "বাকি ইনভয়েস সংখ্যা" : "Unpaid Invoices",
      locale === "bn" ? "প্রাচীনতম চালান তারিখ" : "Oldest Invoice Date",
    ];

    const rows = data.customers.map((c) => [
      c.customerName,
      c.customerPhone || "—",
      c.branchName,
      (c.totalDueMinor / 100).toFixed(2),
      (c.bucket0to30Minor / 100).toFixed(2),
      (c.bucket31to60Minor / 100).toFixed(2),
      (c.bucket61to90Minor / 100).toFixed(2),
      (c.bucketOver90Minor / 100).toFixed(2),
      c.unpaidInvoicesCount,
      c.oldestInvoiceDate ? c.oldestInvoiceDate.slice(0, 10) : "—",
    ]);

    exportToCsv(`due-ageing-report-${new Date().toISOString().slice(0, 10)}`, headers, rows);
  };

  const summary = data?.summary || {
    totalDueMinor: 0,
    bucket0to30Minor: 0,
    bucket31to60Minor: 0,
    bucket61to90Minor: 0,
    bucketOver90Minor: 0,
    customerCount: 0,
    invoiceCount: 0,
  };

  const customers = data?.customers || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-6 w-6 text-amber-600" />
            <span>{locale === "bn" ? "বকেয়া ও বাকি বিশ্লেষণ রিপোর্ট" : "Customer Due & Ageing Report"}</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {locale === "bn"
              ? "গ্রাহকদের অবশিষ্ট বাকির বয়স ও পরিশোধ সংক্রান্ত বিশ্লেষণ (০–৩০, ৩১–৬০, ৬১–৯০, ৯০+ দিন)"
              : "Outstanding customer debt categorized by ageing buckets (0-30, 31-60, 61-90, >90 days)"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={customers.length === 0}
            className="h-9"
          >
            <Download className="h-4 w-4 mr-1.5" />
            <span>{locale === "bn" ? "সিএসভি এক্সপোর্ট" : "Export CSV"}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="h-9"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
            <span>{strings.common.refresh}</span>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building className="h-4 w-4 text-muted-foreground" />
          <label htmlFor="due-branch-select" className="text-xs text-muted-foreground font-medium">
            {locale === "bn" ? "শাখা:" : "Branch:"}
          </label>
          <select
            id="due-branch-select"
            aria-label={locale === "bn" ? "শাখা নির্বাচন করুন" : "Select Branch"}
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-input bg-background text-foreground font-medium"
          >
            <option value="">{locale === "bn" ? "সকল শাখা (All Branches)" : "All Branches"}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-muted-foreground font-mono">
          {summary.customerCount} {locale === "bn" ? "জন গ্রাহকের বাকি রয়েছে" : "customers with due"}
        </div>
      </div>

      {/* Ageing Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Due */}
        <Card className="shadow-xs border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
              {locale === "bn" ? "মোট বকেয়া / বাকি" : "Total Outstanding"}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight text-amber-900 dark:text-amber-200 tabular-nums">
              {formatMoney(summary.totalDueMinor)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {summary.invoiceCount} {locale === "bn" ? "টি চালানে বাকি" : "unpaid invoices"}
            </p>
          </CardContent>
        </Card>

        {/* 0-30 Days */}
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {locale === "bn" ? "০ – ৩০ দিন (চলতি)" : "0 – 30 Days (Current)"}
            </CardTitle>
            <span className="text-xs font-bold text-emerald-600">30d</span>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono tracking-tight text-foreground tabular-nums">
              {formatMoney(summary.bucket0to30Minor)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {locale === "bn" ? "স্বাভাবিক সময়সীমা" : "Regular window"}
            </p>
          </CardContent>
        </Card>

        {/* 31-60 Days */}
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {locale === "bn" ? "৩১ – ৬০ দিন" : "31 – 60 Days"}
            </CardTitle>
            <span className="text-xs font-bold text-blue-600">60d</span>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono tracking-tight text-foreground tabular-nums">
              {formatMoney(summary.bucket31to60Minor)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {locale === "bn" ? "তাগাদা প্রদানযোগ্য" : "Follow-up due"}
            </p>
          </CardContent>
        </Card>

        {/* 61-90 Days */}
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {locale === "bn" ? "৬১ – ৯০ দিন" : "61 – 90 Days"}
            </CardTitle>
            <span className="text-xs font-bold text-amber-600">90d</span>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono tracking-tight text-foreground tabular-nums">
              {formatMoney(summary.bucket61to90Minor)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {locale === "bn" ? "জরুরি তাগাদা" : "Critical follow-up"}
            </p>
          </CardContent>
        </Card>

        {/* >90 Days */}
        <Card className="shadow-xs border-red-500/30 bg-red-500/10 dark:bg-red-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 space-y-0">
            <CardTitle className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
              {locale === "bn" ? "> ৯০ দিন (মেয়াদোত্তীর্ণ)" : "> 90 Days (Overdue)"}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono tracking-tight text-red-700 dark:text-red-400 tabular-nums">
              {formatMoney(summary.bucketOver90Minor)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {locale === "bn" ? "উচ্চ ঝুঁকিপূর্ণ বকেয়া" : "High risk default"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Customer Breakdown Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span>{locale === "bn" ? "গ্রাহক ভিত্তিক বাকি তালিকা" : "Customer Breakdown"}</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b border-border uppercase">
              <tr>
                <th className="py-2.5 px-3">{locale === "bn" ? "গ্রাহকের নাম ও ফোন" : "Customer"}</th>
                <th className="py-2.5 px-3">{locale === "bn" ? "শাখা" : "Branch"}</th>
                <th className="py-2.5 px-3 text-right">{locale === "bn" ? "০-৩০ দিন" : "0-30d"}</th>
                <th className="py-2.5 px-3 text-right">{locale === "bn" ? "৩১-৬০ দিন" : "31-60d"}</th>
                <th className="py-2.5 px-3 text-right">{locale === "bn" ? "৬১-৯০ দিন" : "61-90d"}</th>
                <th className="py-2.5 px-3 text-right text-red-600 font-bold">{locale === "bn" ? ">৯০ দিন" : ">90d"}</th>
                <th className="py-2.5 px-3 text-right font-bold">{locale === "bn" ? "মোট বকেয়া" : "Total Due"}</th>
                <th className="py-2.5 px-3 text-center">{locale === "bn" ? "ইনভয়েস" : "Invoices"}</th>
                <th className="py-2.5 px-3 text-right">{locale === "bn" ? "পদক্ষেপ" : "Action"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    <span>{strings.common.loading}</span>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    {locale === "bn" ? "কোন গ্রাহকের বকেয়া বাকি নেই" : "No outstanding customer due records"}
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.customerId} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-foreground">{c.customerName}</div>
                      <div className="font-mono text-muted-foreground text-[11px]">{c.customerPhone}</div>
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">
                      {c.branchName}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {c.bucket0to30Minor > 0 ? formatMoney(c.bucket0to30Minor) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {c.bucket31to60Minor > 0 ? formatMoney(c.bucket31to60Minor) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {c.bucket61to90Minor > 0 ? formatMoney(c.bucket61to90Minor) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-red-600">
                      {c.bucketOver90Minor > 0 ? formatMoney(c.bucketOver90Minor) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                      {formatMoney(c.totalDueMinor)}
                    </td>
                    <td className="py-3 px-3 text-center font-mono tabular-nums text-muted-foreground">
                      {c.unpaidInvoicesCount}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {c.customerId !== "walk-in" ? (
                        <Link href={`/customers/${c.customerId}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
                            <span>{locale === "bn" ? "স্টেটমেন্ট" : "Statement"}</span>
                            <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
