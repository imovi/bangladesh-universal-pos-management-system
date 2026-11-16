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
  Package,
  Layers,
  Tag,
  Grid,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { formatPaymentMethod } from "@/i18n/formatters";

type ReportTab = "summary" | "variant" | "category" | "brand" | "collection" | "matrix";
type DatePreset = "today" | "yesterday" | "last7days" | "thisMonth" | "custom";

interface ProductItem {
  id: string;
  name: string;
  sku: string;
}

interface SalesSummaryData {
  salesCount: number;
  totalGrossMinor: number;
  totalDiscountMinor: number;
  totalTaxMinor: number;
  totalNetMinor: number;
  paymentsByMethod: Record<string, number>;
}

interface VariantSaleRow {
  variantId: string;
  sku: string;
  productName: string;
  quantitySold: number;
  revenueMinor: number;
  averagePriceMinor: number;
}

interface CategorySaleRow {
  categoryId: string;
  categoryName: string;
  totalRevenueMinor: number;
  itemsCount: number;
}

interface BrandSaleRow {
  brandId: string;
  brandName: string;
  totalRevenueMinor: number;
  itemsCount: number;
}

interface CollectionSaleRow {
  collectionId: string;
  collectionName: string;
  totalRevenueMinor: number;
  itemsCount: number;
}

interface MatrixCell {
  variantId: string;
  sku: string;
  options: Record<string, string>;
  stockQty: number;
  qtySold: number;
}

interface VariantMatrixResponse {
  productId: string;
  productName: string;
  options: string[];
  cells: MatrixCell[];
}

export default function SalesReportsPage() {
  const { currentBranch, apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const [activeTab, setActiveTab] = useState<ReportTab>("summary");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const branchId = currentBranch?.id;
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const todayStr = useMemo(() => formatBusinessDate(new Date(), "Asia/Dhaka"), []);

  // Compute startDate & endDate based on preset
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

  // Products for matrix selector
  const { data: products = [] } = useQuery<ProductItem[]>({
    queryKey: ["products-for-matrix"],
    queryFn: async () => {
      const res = await apiFetch("/products?limit=100");
      if (!res.ok) return [];
      const json = await res.json();
      const d = json.data || json;
      return Array.isArray(d) ? d : (d.items || []);
    },
  });

  // Query 1: Sales Summary
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useQuery<SalesSummaryData>({
    queryKey: ["report-sales-summary", effectiveStartDate, effectiveEndDate, branchId],
    enabled: activeTab === "summary",
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/sales-summary?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load summary");
      const json = await res.json();
      return json.data || json;
    },
  });

  // Query 2: Sales by Variant
  const {
    data: variantData = [],
    isLoading: isVariantLoading,
    refetch: refetchVariant,
  } = useQuery<VariantSaleRow[]>({
    queryKey: ["report-sales-by-variant", effectiveStartDate, effectiveEndDate, branchId],
    enabled: activeTab === "variant",
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/sales-by-variant?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Query 3: Sales by Category
  const {
    data: categoryData = [],
    isLoading: isCategoryLoading,
    refetch: refetchCategory,
  } = useQuery<CategorySaleRow[]>({
    queryKey: ["report-sales-by-category", effectiveStartDate, effectiveEndDate, branchId],
    enabled: activeTab === "category",
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/sales-by-category?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Query 4: Sales by Brand
  const {
    data: brandData = [],
    isLoading: isBrandLoading,
    refetch: refetchBrand,
  } = useQuery<BrandSaleRow[]>({
    queryKey: ["report-sales-by-brand", effectiveStartDate, effectiveEndDate, branchId],
    enabled: activeTab === "brand",
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/sales-by-brand?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Query 5: Sales by Collection
  const {
    data: collectionData = [],
    isLoading: isCollectionLoading,
    refetch: refetchCollection,
  } = useQuery<CollectionSaleRow[]>({
    queryKey: ["report-sales-by-collection", effectiveStartDate, effectiveEndDate, branchId],
    enabled: activeTab === "collection",
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/sales-by-collection?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
  });

  // Query 6: Variant Matrix
  const {
    data: matrixData,
    isLoading: isMatrixLoading,
    refetch: refetchMatrix,
  } = useQuery<VariantMatrixResponse | null>({
    queryKey: ["report-variant-matrix", selectedProductId, branchId],
    enabled: activeTab === "matrix" && Boolean(selectedProductId),
    queryFn: async () => {
      const params = new URLSearchParams({ productId: selectedProductId });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/reports/variant-matrix?${params.toString()}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data || json;
    },
  });

  // CSV Export Handlers
  const handleExportCsv = () => {
    const dateRangeSuffix = `${effectiveStartDate}_to_${effectiveEndDate}`;

    if (activeTab === "summary" && summaryData) {
      const headers = ["Metric", "Amount / Value"];
      const rows = [
        [strings.reports.salesCount, summaryData.salesCount],
        [strings.reports.totalGross, (summaryData.totalGrossMinor / 100).toFixed(2)],
        [strings.reports.totalDiscount, (summaryData.totalDiscountMinor / 100).toFixed(2)],
        [strings.reports.totalTax, (summaryData.totalTaxMinor / 100).toFixed(2)],
        [strings.reports.totalNet, (summaryData.totalNetMinor / 100).toFixed(2)],
        ...Object.entries(summaryData.paymentsByMethod).map(([m, val]) => [
          `Payment - ${m.toUpperCase()}`,
          (val / 100).toFixed(2),
        ]),
      ];
      exportToCsv(`sales_summary_${dateRangeSuffix}`, headers, rows);
    } else if (activeTab === "variant") {
      const headers = [
        strings.reports.product,
        strings.reports.sku,
        strings.reports.qtySold,
        `${strings.reports.revenue} (BDT)`,
        `${strings.reports.avgPrice} (BDT)`,
      ];
      const rows = variantData.map((r) => [
        r.productName,
        r.sku,
        r.quantitySold,
        (r.revenueMinor / 100).toFixed(2),
        (r.averagePriceMinor / 100).toFixed(2),
      ]);
      exportToCsv(`sales_by_variant_${dateRangeSuffix}`, headers, rows);
    } else if (activeTab === "category") {
      const headers = [
        strings.reports.category,
        strings.reports.itemsSold,
        `${strings.reports.revenue} (BDT)`,
      ];
      const rows = categoryData.map((r) => [
        r.categoryName,
        r.itemsCount,
        (r.totalRevenueMinor / 100).toFixed(2),
      ]);
      exportToCsv(`sales_by_category_${dateRangeSuffix}`, headers, rows);
    } else if (activeTab === "brand") {
      const headers = [
        strings.reports.brand,
        strings.reports.itemsSold,
        `${strings.reports.revenue} (BDT)`,
      ];
      const rows = brandData.map((r) => [
        r.brandName,
        r.itemsCount,
        (r.totalRevenueMinor / 100).toFixed(2),
      ]);
      exportToCsv(`sales_by_brand_${dateRangeSuffix}`, headers, rows);
    } else if (activeTab === "collection") {
      const headers = [
        strings.reports.collection,
        strings.reports.itemsSold,
        `${strings.reports.revenue} (BDT)`,
      ];
      const rows = collectionData.map((r) => [
        r.collectionName,
        r.itemsCount,
        (r.totalRevenueMinor / 100).toFixed(2),
      ]);
      exportToCsv(`sales_by_collection_${dateRangeSuffix}`, headers, rows);
    } else if (activeTab === "matrix" && matrixData) {
      const optHeaders = matrixData.options;
      const headers = [
        strings.reports.sku,
        ...optHeaders,
        strings.reports.stockUnits,
        strings.reports.qtySold,
      ];
      const rows = matrixData.cells.map((c) => [
        c.sku,
        ...optHeaders.map((opt) => c.options[opt] || "-"),
        c.stockQty,
        c.qtySold,
      ]);
      exportToCsv(`variant_matrix_${matrixData.productName}`, headers, rows);
    }
  };

  const handleRefresh = () => {
    if (activeTab === "summary") refetchSummary();
    if (activeTab === "variant") refetchVariant();
    if (activeTab === "category") refetchCategory();
    if (activeTab === "brand") refetchBrand();
    if (activeTab === "collection") refetchCollection();
    if (activeTab === "matrix") refetchMatrix();
  };

  return (
    <div className="space-y-6">
        {/* Top Header & Range Controls */}
        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                {strings.reports.salesReports}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {locale === "bn"
                  ? "তারিখ ও শাখা ভিত্তিক বিস্তারিত বিক্রির হিসাব"
                  : "Comprehensive sales performance and breakdown"}
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
                onClick={handleRefresh}
                className="h-8 px-2.5"
                aria-label="Refresh report"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            {/* Date Preset Buttons */}
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

            {/* Custom Date Pickers */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {datePreset === "custom" && (
                <DateRangePicker
                  startDate={customStart}
                  endDate={customEnd}
                  onChange={({ startDate, endDate }) => {
                    setCustomStart(startDate);
                    setCustomEnd(endDate);
                  }}
                  aria-label="Filter report by date range"
                />
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-1 text-sm font-medium">
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "summary"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            <span>{strings.reports.summary}</span>
          </button>

          <button
            onClick={() => setActiveTab("variant")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "variant"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Package className="h-4 w-4" />
            <span>{strings.reports.byVariant}</span>
          </button>

          <button
            onClick={() => setActiveTab("category")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "category"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>{strings.reports.byCategory}</span>
          </button>

          <button
            onClick={() => setActiveTab("brand")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "brand"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Tag className="h-4 w-4" />
            <span>{strings.reports.byBrand}</span>
          </button>

          <button
            onClick={() => setActiveTab("collection")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "collection"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Tag className="h-4 w-4" />
            <span>{strings.reports.byCollection}</span>
          </button>

          <button
            onClick={() => setActiveTab("matrix")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "matrix"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Grid className="h-4 w-4" />
            <span>{strings.reports.matrix}</span>
          </button>
        </div>

        {/* Tab 1: Sales Summary */}
        {activeTab === "summary" && (
          <div className="space-y-6">
            {isSummaryLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                {strings.common.loading}
              </div>
            ) : summaryData ? (
              <>
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                        {strings.reports.totalNet}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground tabular-nums">
                        {formatMoney(summaryData.totalNetMinor)}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {summaryData.salesCount} {locale === "bn" ? "টি ভাউচার" : "sales"}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                        {strings.reports.totalGross}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground tabular-nums">
                        {formatMoney(summaryData.totalGrossMinor)}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {locale === "bn" ? "ছাড়পূর্ব মোট মূল্য" : "Before discounts"}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                        {strings.reports.totalDiscount}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground tabular-nums">
                        {formatMoney(summaryData.totalDiscountMinor)}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {locale === "bn" ? "গ্রাহককে দেওয়া ছাড়" : "Total discount given"}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                        {strings.reports.totalTax}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground tabular-nums">
                        {formatMoney(summaryData.totalTaxMinor)}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {locale === "bn" ? "সংগৃহীত ভ্যাট/ট্যাক্স" : "Collected VAT/Tax"}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Accessible Visual Distribution Bar */}
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      {locale === "bn" ? "বিক্রির আর্থিক কাঠামো" : "Sales Revenue Composition"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {summaryData.totalGrossMinor > 0 && (
                      <div
                        className="h-4 w-full bg-muted rounded-full overflow-hidden flex border border-border"
                        role="progressbar"
                        aria-label="Sales breakdown"
                        aria-valuenow={100}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          style={{
                            width: `${Math.max(
                              0,
                              ((summaryData.totalNetMinor - summaryData.totalTaxMinor) /
                                summaryData.totalGrossMinor) *
                                100,
                            )}%`,
                          }}
                          className="bg-emerald-500 h-full"
                          title="Net Sales (Pre-Tax)"
                        />
                        <div
                          style={{
                            width: `${Math.max(
                              0,
                              (summaryData.totalTaxMinor / summaryData.totalGrossMinor) * 100,
                            )}%`,
                          }}
                          className="bg-blue-500 h-full"
                          title="Tax / VAT"
                        />
                        <div
                          style={{
                            width: `${Math.max(
                              0,
                              (summaryData.totalDiscountMinor / summaryData.totalGrossMinor) * 100,
                            )}%`,
                          }}
                          className="bg-amber-500 h-full"
                          title="Discounts"
                        />
                      </div>
                    )}

                    {/* Breakdown Table matching the bar */}
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium">{locale === "bn" ? "খাত" : "Component"}</th>
                            <th className="py-2 px-3 text-right font-medium">{locale === "bn" ? "পরিমাণ (টাকা)" : "Amount (BDT)"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          <tr>
                            <td className="py-2 px-3 font-medium flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              {strings.reports.totalNet}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              {formatMoney(summaryData.totalNetMinor)}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-blue-500" />
                              {strings.reports.totalTax}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-blue-600 dark:text-blue-400">
                              {formatMoney(summaryData.totalTaxMinor)}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-amber-500" />
                              {strings.reports.totalDiscount}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                              {formatMoney(summaryData.totalDiscountMinor)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Payment Methods Breakdown */}
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      {strings.reports.paymentsByMethod}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium">{locale === "bn" ? "পেমেন্ট মাধ্যম" : "Payment Method"}</th>
                            <th className="py-2 px-3 text-right font-medium">{locale === "bn" ? "মোট সংগৃহীত" : "Total Collected"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {Object.entries(summaryData.paymentsByMethod).map(([method, amount]) => (
                            <tr key={method}>
                              <td className="py-2 px-3 font-medium">{formatPaymentMethod(method, strings)}</td>
                              <td className="py-2 px-3 text-right font-semibold tabular-nums">{formatMoney(amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {strings.reports.noDataForPeriod}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Sales by Product & Variant */}
        {activeTab === "variant" && (
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <CardTitle className="text-sm font-semibold">{strings.reports.byVariant}</CardTitle>
              <span className="text-xs text-muted-foreground">{variantData.length} {locale === "bn" ? "টি আইটেম" : "items"}</span>
            </CardHeader>
            <CardContent className="pt-4">
              {isVariantLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                  {strings.common.loading}
                </div>
              ) : variantData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {strings.reports.noDataForPeriod}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">{strings.reports.product}</th>
                        <th className="py-2 px-3 text-left font-medium">{strings.reports.sku}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.qtySold}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.revenue}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.avgPrice}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {variantData.map((row) => (
                        <tr key={row.variantId} className="hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium text-foreground">{row.productName}</td>
                          <td className="py-2 px-3 font-mono text-muted-foreground">{row.sku}</td>
                          <td className="py-2 px-3 text-right font-bold">{row.quantitySold}</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(row.revenueMinor)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{formatMoney(row.averagePriceMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab 3: Sales by Category */}
        {activeTab === "category" && (
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <CardTitle className="text-sm font-semibold">{strings.reports.byCategory}</CardTitle>
              <span className="text-xs text-muted-foreground">{categoryData.length} {locale === "bn" ? "টি ক্যাটাগরি" : "categories"}</span>
            </CardHeader>
            <CardContent className="pt-4">
              {isCategoryLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                  {strings.common.loading}
                </div>
              ) : categoryData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {strings.reports.noDataForPeriod}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">{strings.reports.category}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.itemsSold}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.revenue}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {categoryData.map((row) => (
                        <tr key={row.categoryId} className="hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium text-foreground">{row.categoryName}</td>
                          <td className="py-2 px-3 text-right font-bold">{row.itemsCount}</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(row.totalRevenueMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab 4: Sales by Brand */}
        {activeTab === "brand" && (
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <CardTitle className="text-sm font-semibold">{strings.reports.byBrand}</CardTitle>
              <span className="text-xs text-muted-foreground">{brandData.length} {locale === "bn" ? "টি ব্র্যান্ড" : "brands"}</span>
            </CardHeader>
            <CardContent className="pt-4">
              {isBrandLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                  {strings.common.loading}
                </div>
              ) : brandData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {strings.reports.noDataForPeriod}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">{strings.reports.brand}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.itemsSold}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.revenue}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {brandData.map((row) => (
                        <tr key={row.brandId} className="hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium text-foreground">{row.brandName}</td>
                          <td className="py-2 px-3 text-right font-bold">{row.itemsCount}</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(row.totalRevenueMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab 5: Sales by Collection */}
        {activeTab === "collection" && (
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <CardTitle className="text-sm font-semibold">{strings.reports.byCollection}</CardTitle>
              <span className="text-xs text-muted-foreground">{collectionData.length} {locale === "bn" ? "টি কালেকশন" : "collections"}</span>
            </CardHeader>
            <CardContent className="pt-4">
              {isCollectionLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                  {strings.common.loading}
                </div>
              ) : collectionData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {strings.reports.noDataForPeriod}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">{strings.reports.collection}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.itemsSold}</th>
                        <th className="py-2 px-3 text-right font-medium">{strings.reports.revenue}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {collectionData.map((row) => (
                        <tr key={row.collectionId} className="hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium text-foreground">{row.collectionName}</td>
                          <td className="py-2 px-3 text-right font-bold">{row.itemsCount}</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(row.totalRevenueMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab 6: Variant Matrix (Size and Colour Grid) */}
        {activeTab === "matrix" && (
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b border-border space-y-2">
              <CardTitle className="text-sm font-semibold">{strings.reports.matrix}</CardTitle>
              <p className="text-xs text-muted-foreground">{strings.reports.selectProductHelp}</p>

              {/* Product Selector Dropdown */}
              <div className="pt-2 max-w-sm">
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-muted/60 border border-border font-medium focus:outline-none"
                  aria-label="Select product for matrix"
                >
                  <option value="">-- {strings.reports.selectProduct} --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {!selectedProductId ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  {locale === "bn"
                    ? "ম্যাট্রিক্স দেখতে উপর থেকে একটি পণ্য বেছে নিন"
                    : "Please select a product above to inspect variant matrix"}
                </div>
              ) : isMatrixLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                  {strings.common.loading}
                </div>
              ) : matrixData && matrixData.cells.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-foreground">
                    {matrixData.productName} — {matrixData.cells.length} {locale === "bn" ? "টি ভ্যারিয়েন্ট সমন্বয়" : "variant combinations"}
                  </div>

                  <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="py-2 px-3 text-left font-medium">{strings.reports.sku}</th>
                          {matrixData.options.map((opt) => (
                            <th key={opt} className="py-2 px-3 text-left font-medium">
                              {opt}
                            </th>
                          ))}
                          <th className="py-2 px-3 text-right font-medium">{strings.reports.stockUnits}</th>
                          <th className="py-2 px-3 text-right font-medium">{strings.reports.qtySold}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {matrixData.cells.map((cell) => (
                          <tr key={cell.variantId} className="hover:bg-muted/30">
                            <td className="py-2 px-3 font-mono font-medium">{cell.sku}</td>
                            {matrixData.options.map((opt) => (
                              <td key={opt} className="py-2 px-3 font-medium text-foreground">
                                {cell.options[opt] || "-"}
                              </td>
                            ))}
                            <td className="py-2 px-3 text-right font-bold text-foreground">
                              {cell.stockQty}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              {cell.qtySold}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  {locale === "bn" ? "এই পণ্যের কোনো ভ্যারিয়েন্ট পাওয়া যায়নি" : "No variants found for this product"}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
  );
}
