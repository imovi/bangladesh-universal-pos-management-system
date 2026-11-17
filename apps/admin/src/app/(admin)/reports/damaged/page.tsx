"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import {
  AlertTriangle,
  Download,
  Building,
  TrendingDown,
  Truck,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DamagedStockReportData {
  summary: {
    totalDamagedUnits: number;
    totalLossMinor: number;
    byMovementType: {
      saleReturnDamagedUnits: number;
      saleReturnDamagedLossMinor: number;
      transferLossUnits: number;
      transferLossMinor: number;
      otherLossUnits: number;
      otherLossMinor: number;
    };
  };
  items: Array<{
    id: string;
    createdAt: string;
    branchName: string;
    productName: string;
    variantSku: string;
    movementType: string;
    quantity: number;
    unitCostMinor: number;
    totalLossMinor: number;
    reason: string;
    referenceId: string | null;
  }>;
}

export default function DamagedStockReportPage() {
  const { currentBranch, user, apiFetch } = useAuth();
  const branches = user?.branches || [];
  const { locale } = useTranslation();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");
  const [selectedType, setSelectedType] = useState<string>("all");

  const { data, isLoading } = useQuery<DamagedStockReportData>({
    queryKey: ["damaged-stock-report", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);

      const res = await apiFetch(`/reports/damaged-stock?${params.toString()}`);
      if (!res.ok) {
        return {
          summary: {
            totalDamagedUnits: 0,
            totalLossMinor: 0,
            byMovementType: {
              saleReturnDamagedUnits: 0,
              saleReturnDamagedLossMinor: 0,
              transferLossUnits: 0,
              transferLossMinor: 0,
              otherLossUnits: 0,
              otherLossMinor: 0,
            },
          },
          items: [],
        };
      }
      const json = await res.json();
      return json.data || json;
    },
  });

  const filteredItems = (data?.items || []).filter((item) => {
    if (selectedType === "all") return true;
    return item.movementType === selectedType;
  });

  const handleExportCsv = () => {
    if (!filteredItems.length) return;

    const headers = [
      locale === "bn" ? "তারিখ" : "Date",
      locale === "bn" ? "শাখা" : "Branch",
      locale === "bn" ? "পণ্য" : "Product",
      locale === "bn" ? "ভ্যারিয়েন্ট" : "SKU",
      locale === "bn" ? "ক্ষতির ধরন" : "Loss Type",
      locale === "bn" ? "পরিমাণ" : "Qty",
      locale === "bn" ? "ইউনিট খরচ (টাকা)" : "Unit Cost (BDT)",
      locale === "bn" ? "মোট ক্ষতি (টাকা)" : "Total Loss (BDT)",
      locale === "bn" ? "কারণ" : "Reason",
      locale === "bn" ? "রেফারেন্স" : "Reference",
    ];

    const rows = filteredItems.map((i) => [
      i.createdAt.slice(0, 10),
      i.branchName,
      i.productName,
      i.variantSku,
      i.movementType === "sale_return_damaged"
        ? locale === "bn" ? "বিক্রয় ফেরত ক্ষতি" : "Return Damaged"
        : locale === "bn" ? "স্থানান্তর ঘাটতি" : "Transfer Loss",
      i.quantity,
      (i.unitCostMinor / 100).toFixed(2),
      (i.totalLossMinor / 100).toFixed(2),
      i.reason,
      i.referenceId || "—",
    ]);

    exportToCsv(`damaged-stock-report-${new Date().toISOString().slice(0, 10)}`, headers, rows);
  };

  const summary = data?.summary || {
    totalDamagedUnits: 0,
    totalLossMinor: 0,
    byMovementType: {
      saleReturnDamagedUnits: 0,
      saleReturnDamagedLossMinor: 0,
      transferLossUnits: 0,
      transferLossMinor: 0,
      otherLossUnits: 0,
      otherLossMinor: 0,
    },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            {locale === "bn" ? "ক্ষতিগ্রস্ত পণ্য ও লোকসান রিপোর্ট" : "Damaged Stock & Loss Report"}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {locale === "bn"
              ? "বিক্রয় ফেরত ও স্থানান্তরে ক্ষতিগ্রস্ত বা হারিয়ে যাওয়া পণ্যের আর্থিক ক্ষতি"
              : "Financial loss audit from customer returns and inter-branch transit losses"}
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

          {/* Loss Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-sm bg-white dark:bg-zinc-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">{locale === "bn" ? "সকল ধরনের ক্ষতি" : "All Loss Types"}</option>
            <option value="sale_return_damaged">{locale === "bn" ? "বিক্রয় ফেরত ক্ষতি" : "Return Damaged"}</option>
            <option value="transfer_loss">{locale === "bn" ? "ট্রান্সফার স্থানান্তর ক্ষতি" : "Transfer Loss"}</option>
          </select>

          {/* Export CSV */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!filteredItems.length}
            className="flex items-center gap-1.5"
            data-testid="export-damaged-csv-btn"
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
              {locale === "bn" ? "মোট ক্ষতিগ্রস্ত পণ্য" : "Total Damaged Units"}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="damaged-total-units">
              {summary.totalDamagedUnits} {locale === "bn" ? "টি" : "pcs"}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {locale === "bn" ? "ফেরত ও ট্রানজিট মিলিয়ে" : "Combined returns & transit"}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "মোট আর্থিক ক্ষতি" : "Total Cost Loss"}
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-600" data-testid="damaged-total-loss">
              {formatMoney(summary.totalLossMinor)}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {locale === "bn" ? "ক্রয়মূল্যের ভিত্তিতে ক্ষতি" : "Based on purchase unit cost"}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "ফেরত ক্ষতি" : "Return Losses"}
            </CardTitle>
            <RotateCcw className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-rose-600" data-testid="return-loss-amount">
              {formatMoney(summary.byMovementType.saleReturnDamagedLossMinor)}
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              {summary.byMovementType.saleReturnDamagedUnits} {locale === "bn" ? "টি ফেরত পণ্য" : "pcs damaged returns"}
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {locale === "bn" ? "স্থানান্তর ক্ষতি" : "Transfer Losses"}
            </CardTitle>
            <Truck className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-indigo-600" data-testid="transfer-loss-amount">
              {formatMoney(summary.byMovementType.transferLossMinor)}
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              {summary.byMovementType.transferLossUnits} {locale === "bn" ? "টি ট্রানজিটে ক্ষতি" : "pcs transit loss"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Damaged Stock Movements Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase border-b">
                <tr>
                  <th className="px-4 py-3">{locale === "bn" ? "তারিখ" : "Date"}</th>
                  <th className="px-4 py-3">{locale === "bn" ? "শাখা" : "Branch"}</th>
                  <th className="px-4 py-3">{locale === "bn" ? "পণ্য ও ভ্যারিয়েন্ট" : "Product & SKU"}</th>
                  <th className="px-4 py-3 text-center">{locale === "bn" ? "ক্ষতির ধরন" : "Type"}</th>
                  <th className="px-4 py-3 text-center">{locale === "bn" ? "পরিমাণ" : "Qty"}</th>
                  <th className="px-4 py-3 text-right">{locale === "bn" ? "একক খরচ" : "Unit Cost"}</th>
                  <th className="px-4 py-3 text-right">{locale === "bn" ? "মোট ক্ষতি" : "Total Loss"}</th>
                  <th className="px-4 py-3">{locale === "bn" ? "কারণ / বিবরণ" : "Reason"}</th>
                  <th className="px-4 py-3 font-mono text-xs">{locale === "bn" ? "রেফারেন্স" : "Ref"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-zinc-500">
                      {locale === "bn" ? "লোড হচ্ছে..." : "Loading..."}
                    </td>
                  </tr>
                ) : !filteredItems.length ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-zinc-500">
                      {locale === "bn" ? "কোনো ক্ষতিগ্রস্ত পণ্যের রেকর্ড পাওয়া যায়নি" : "No damaged stock records found"}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
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
                      <td className="px-4 py-3 text-center">
                        <Badge variant={item.movementType === "sale_return_damaged" ? "destructive" : "secondary"}>
                          {item.movementType === "sale_return_damaged"
                            ? locale === "bn" ? "ফেরত ক্ষতি" : "Return Damaged"
                            : locale === "bn" ? "ট্রান্সফার ক্ষতি" : "Transfer Loss"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-semibold text-red-600">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-600 dark:text-zinc-400">
                        {formatMoney(item.unitCostMinor)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-red-600">
                        {formatMoney(item.totalLossMinor)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                        {item.reason}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                        {item.referenceId || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
