"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import {
  RotateCcw,
  Download,
  AlertTriangle,
  Building,
  CheckCircle2,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ReturnsReportData {
  summary: {
    returnsCount: number;
    totalRefundMinor: number;
    totalReturnedUnits: number;
    resellableUnits: number;
    damagedUnits: number;
    resellableRefundMinor: number;
    damagedRefundMinor: number;
  };
  byDay: Array<{
    date: string;
    returnsCount: number;
    totalRefundMinor: number;
    units: number;
  }>;
  byReason: Array<{
    reason: string;
    count: number;
    totalRefundMinor: number;
  }>;
  productReturnRates: Array<{
    productId: string;
    productName: string;
    soldUnits: number;
    returnedUnits: number;
    returnRatePercent: number;
  }>;
  items: Array<{
    id: string;
    returnInvoiceNumber: string;
    saleInvoiceNumber: string;
    createdAt: string;
    branchName: string;
    productName: string;
    variantSku: string;
    quantity: number;
    refundMinor: number;
    condition: string;
    reason: string;
  }>;
}

export default function ReturnsReportPage() {
  const { currentBranch, user, apiFetch } = useAuth();
  const branches = user?.branches || [];
  const { locale } = useTranslation();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");
  const [selectedCondition, setSelectedCondition] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"items" | "rates" | "daily">("items");

  const { data, isLoading } = useQuery<ReturnsReportData>({
    queryKey: ["returns-report", selectedBranchId, selectedCondition],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      if (selectedCondition && selectedCondition !== "all") params.set("condition", selectedCondition);

      const res = await apiFetch(`/reports/returns?${params.toString()}`);
      if (!res.ok) {
        return {
          summary: {
            returnsCount: 0,
            totalRefundMinor: 0,
            totalReturnedUnits: 0,
            resellableUnits: 0,
            damagedUnits: 0,
            resellableRefundMinor: 0,
            damagedRefundMinor: 0,
          },
          byDay: [],
          byReason: [],
          productReturnRates: [],
          items: [],
        };
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  const handleExportCsv = () => {
    if (!data?.items || data.items.length === 0) return;

    const headers = [
      locale === "bn" ? "ফেরত চালান" : "Return Invoice",
      locale === "bn" ? "আসল চালান" : "Original Sale",
      locale === "bn" ? "তারিখ" : "Date",
      locale === "bn" ? "শাখা" : "Branch",
      locale === "bn" ? "পণ্য" : "Product",
      locale === "bn" ? "ভ্যারিয়েন্ট" : "SKU",
      locale === "bn" ? "পরিমাণ" : "Qty",
      locale === "bn" ? "ফেরত অর্থ (টাকা)" : "Refund (BDT)",
      locale === "bn" ? "অবস্থা" : "Condition",
      locale === "bn" ? "কারণ" : "Reason",
    ];

    const rows = data.items.map((i) => [
      i.returnInvoiceNumber,
      i.saleInvoiceNumber,
      i.createdAt.slice(0, 10),
      i.branchName,
      i.productName,
      i.variantSku,
      i.quantity,
      (i.refundMinor / 100).toFixed(2),
      i.condition === "resellable" ? (locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable") : (locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"),
      i.reason,
    ]);

    exportToCsv(`returns-report-${new Date().toISOString().slice(0, 10)}`, headers, rows);
  };

  const summary = data?.summary || {
    returnsCount: 0,
    totalRefundMinor: 0,
    totalReturnedUnits: 0,
    resellableUnits: 0,
    damagedUnits: 0,
    resellableRefundMinor: 0,
    damagedRefundMinor: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-rose-600" />
            {locale === "bn" ? "পণ্য ফেরত রিপোর্ট" : "Returns & Refund Report"}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {locale === "bn"
              ? "পণ্য ফেরত, কারণ বিশ্লেষণ এবং পণ্যভিত্তিক ফেরত হার"
              : "Returns analysis, refund figures, and return rate per product"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Branch Filter */}
          <div className="flex items-center gap-2">
            <Building className="h-4 w-4 text-zinc-400" />
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="text-sm bg-white dark:bg-zinc-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{locale === "bn" ? "সকল শাখা" : "All Branches"}</option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          {/* Condition Filter */}
          <select
            value={selectedCondition}
            onChange={(e) => setSelectedCondition(e.target.value)}
            className="text-sm bg-white dark:bg-zinc-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">{locale === "bn" ? "সকল অবস্থা" : "All Conditions"}</option>
            <option value="resellable">{locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable"}</option>
            <option value="damaged">{locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"}</option>
          </select>

          {/* CSV Export Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!data?.items?.length}
            className="flex items-center gap-1.5"
            data-testid="export-returns-csv-btn"
          >
            <Download className="h-4 w-4" />
            {locale === "bn" ? "CSV এক্সপোর্ট" : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "মোট ফেরত ইনভয়েস" : "Total Returns"}
            </CardTitle>
            <RotateCcw className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="returns-count">
              {summary.returnsCount}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {summary.totalReturnedUnits} {locale === "bn" ? "পিস পণ্য" : "items returned"}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "মোট ফেরত অর্থ" : "Total Refund"}
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-rose-600" data-testid="returns-amount">
              {formatMoney(summary.totalRefundMinor)}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {locale === "bn" ? "কাস্টমারকে ফেরত দেওয়া হয়েছে" : "Refunded to customers"}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "বিক্রয়যোগ্য ফেরত" : "Resellable Returns"}
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600" data-testid="resellable-units">
              {summary.resellableUnits} {locale === "bn" ? "টি" : "pcs"}
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              {formatMoney(summary.resellableRefundMinor)}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "ক্ষতিগ্রস্ত ফেরত" : "Damaged Returns"}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600" data-testid="damaged-units">
              {summary.damagedUnits} {locale === "bn" ? "টি" : "pcs"}
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              {formatMoney(summary.damagedRefundMinor)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <button
          onClick={() => setActiveTab("items")}
          className={`pb-2 text-sm font-medium border-b-2 transition ${
            activeTab === "items"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {locale === "bn" ? "ফেরতের তালিকা" : "Return Items List"}
        </button>
        <button
          onClick={() => setActiveTab("rates")}
          className={`pb-2 text-sm font-medium border-b-2 transition ${
            activeTab === "rates"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {locale === "bn" ? "পণ্যভিত্তিক ফেরত হার" : "Product Return Rates"}
        </button>
        <button
          onClick={() => setActiveTab("daily")}
          className={`pb-2 text-sm font-medium border-b-2 transition ${
            activeTab === "daily"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {locale === "bn" ? "দৈনিক ট্রেন্ড" : "Daily Trend"}
        </button>
      </div>

      {/* Tab 1: Return Items List Table */}
      {activeTab === "items" && (
        <Card className="border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3">{locale === "bn" ? "ফেরত চালান" : "Return Invoice"}</th>
                    <th className="px-4 py-3">{locale === "bn" ? "তারিখ" : "Date"}</th>
                    <th className="px-4 py-3">{locale === "bn" ? "শাখা" : "Branch"}</th>
                    <th className="px-4 py-3">{locale === "bn" ? "পণ্য ও ভ্যারিয়েন্ট" : "Product & Variant"}</th>
                    <th className="px-4 py-3 text-center">{locale === "bn" ? "পরিমাণ" : "Qty"}</th>
                    <th className="px-4 py-3 text-right">{locale === "bn" ? "ফেরত অর্থ" : "Refund"}</th>
                    <th className="px-4 py-3 text-center">{locale === "bn" ? "অবস্থা" : "Condition"}</th>
                    <th className="px-4 py-3">{locale === "bn" ? "কারণ" : "Reason"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-500">
                        {locale === "bn" ? "লোড হচ্ছে..." : "Loading..."}
                      </td>
                    </tr>
                  ) : !data?.items?.length ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-500">
                        {locale === "bn" ? "কোনো পণ্য ফেরত রেকর্ড পাওয়া যায়নি" : "No return records found"}
                      </td>
                    </tr>
                  ) : (
                    data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-3 font-mono font-medium text-rose-600">
                          {item.returnInvoiceNumber}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">
                          {item.createdAt.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                          {item.branchName}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">{item.productName}</div>
                          <div className="text-xs text-zinc-500 font-mono">{item.variantSku}</div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-semibold">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-rose-600">
                          {formatMoney(item.refundMinor)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={item.condition === "resellable" ? "default" : "destructive"}>
                            {item.condition === "resellable"
                              ? locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable"
                              : locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {item.reason}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Product Return Rates Table */}
      {activeTab === "rates" && (
        <Card className="border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3">{locale === "bn" ? "পণ্যের নাম" : "Product Name"}</th>
                    <th className="px-4 py-3 text-right">{locale === "bn" ? "মোট বিক্রি (পিস)" : "Units Sold"}</th>
                    <th className="px-4 py-3 text-right">{locale === "bn" ? "ফেরত (পিস)" : "Units Returned"}</th>
                    <th className="px-4 py-3 text-right">{locale === "bn" ? "ফেরত হার (%)" : "Return Rate (%)"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {!data?.productReturnRates?.length ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-500">
                        {locale === "bn" ? "কোনো তথ্য পাওয়া যায়নি" : "No return rate data"}
                      </td>
                    </tr>
                  ) : (
                    data.productReturnRates.map((p) => (
                      <tr key={p.productId} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          {p.productName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{p.soldUnits}</td>
                        <td className="px-4 py-3 text-right font-mono text-rose-600">{p.returnedUnits}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                          <span className={p.returnRatePercent > 20 ? "text-red-600" : "text-zinc-700"}>
                            {p.returnRatePercent}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Daily Trend Table */}
      {activeTab === "daily" && (
        <Card className="border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3">{locale === "bn" ? "তারিখ" : "Date"}</th>
                    <th className="px-4 py-3 text-center">{locale === "bn" ? "চালান সংখ্যা" : "Returns Count"}</th>
                    <th className="px-4 py-3 text-right">{locale === "bn" ? "মোট ফেরত অর্থ" : "Total Refund"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {!data?.byDay?.length ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-zinc-500">
                        {locale === "bn" ? "কোনো দৈনিক তথ্য নেই" : "No daily records"}
                      </td>
                    </tr>
                  ) : (
                    data.byDay.map((d) => (
                      <tr key={d.date} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-3 font-medium font-mono">{d.date}</td>
                        <td className="px-4 py-3 text-center font-mono">{d.returnsCount}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-rose-600">
                          {formatMoney(d.totalRefundMinor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
