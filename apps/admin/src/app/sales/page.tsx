"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Eye,
  Calendar,
  Receipt,
  RefreshCw,
  X,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface SalePayment {
  id: string;
  paymentMethod: string;
  amountMinor: number;
}

interface SaleItem {
  id: string;
  variantId: string;
  quantity: number;
  totalMinor: number;
}

interface SaleRecord {
  id: string;
  invoiceNumber: string;
  status: string;
  totalMinor: number;
  subtotalMinor?: number;
  totalDiscountMinor?: number;
  taxAmountMinor?: number;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
  } | null;
  cashierUser?: {
    id: string;
    name: string;
  } | null;
  branchId?: string;
  shiftId?: string;
  payments?: SalePayment[];
  items?: SaleItem[];
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function SalesPage() {
  const { apiFetch } = useAuth();
  const { strings } = useTranslation();

  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch branches for filter
  useEffect(() => {
    let isCurrent = true;
    async function loadBranches() {
      try {
        const res = await apiFetch("/branches");
        if (res.ok) {
          const json = await res.json();
          if (isCurrent) {
            setBranches(Array.isArray(json.data) ? json.data : (json.data?.items || []));
          }
        }
      } catch {
        // Ignore branch loading error
      }
    }
    loadBranches();
    return () => {
      isCurrent = false;
    };
  }, [apiFetch]);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);
      if (branchFilter && branchFilter !== "all") queryParams.set("branchId", branchFilter);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);
      if (paymentFilter && paymentFilter !== "all") queryParams.set("paymentMethod", paymentFilter);
      if (startDate) queryParams.set("startDate", new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        queryParams.set("endDate", end.toISOString());
      }
      queryParams.set("page", page.toString());
      queryParams.set("limit", "20");

      const res = await apiFetch(`/sales?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setSales(items);
        if (json.data?.meta) {
          setTotalPages(json.data.meta.totalPages || 1);
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage("Failed to load sales");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, search, branchFilter, statusFilter, paymentFilter, startDate, endDate, page]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchSales();
    }, 250);
    return () => clearTimeout(handler);
  }, [fetchSales]);

  const clearFilters = () => {
    setSearch("");
    setBranchFilter("all");
    setStatusFilter("all");
    setPaymentFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const hasActiveFilters =
    search || branchFilter !== "all" || statusFilter !== "all" || paymentFilter !== "all" || startDate || endDate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            {strings.sales.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.sales.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchSales()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {strings.common.refresh}
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search by Invoice */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={strings.sales.searchReceiptPlaceholder}
              className="pl-9"
            />
          </div>

          {/* Branch Filter */}
          <div>
            <select
              value={branchFilter}
              onChange={(e) => {
                setBranchFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="all">{strings.sales.allBranches}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="all">{strings.sales.allStatuses}</option>
              <option value="completed">{strings.sales.statusCompleted}</option>
              <option value="voided">{strings.sales.statusVoided}</option>
            </select>
          </div>

          {/* Payment Method Filter */}
          <div>
            <select
              value={paymentFilter}
              onChange={(e) => {
                setPaymentFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="all">{strings.sales.allPaymentMethods}</option>
              <option value="cash">{strings.purchasing.payMethodCash}</option>
              <option value="card">Card</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="rocket">Rocket</option>
              <option value="bank_transfer">{strings.purchasing.payMethodBank}</option>
            </select>
          </div>
        </div>

        {/* Date Filters & Clear */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span>{strings.reports.dateRange}:</span>
            </div>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-36 h-8 text-xs"
            />
            <span className="text-muted-foreground text-xs">-</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-36 h-8 text-xs"
            />
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground h-8">
              <X className="h-3.5 w-3.5 mr-1" />
              {strings.sales.clearFilters}
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Sales List Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="py-3 px-4">{strings.sales.receiptNumber}</th>
                <th className="py-3 px-4">{strings.sales.dateTime}</th>
                <th className="py-3 px-4">{strings.sales.customer}</th>
                <th className="py-3 px-4">{strings.sales.paymentMethod}</th>
                <th className="py-3 px-4 text-center">{strings.common.status}</th>
                <th className="py-3 px-4 text-right">{strings.sales.total}</th>
                <th className="py-3 px-4 text-center">{strings.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    {strings.common.loading}
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {strings.common.noData}
                  </td>
                </tr>
              ) : (
                sales.map((s) => {
                  const isVoided = s.status === "voided";
                  return (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-foreground">
                        <Link
                          href={`/sales/${s.id}`}
                          className="hover:underline text-primary flex items-center gap-1.5"
                        >
                          {s.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {s.customer ? (
                          <div>
                            <span className="font-medium block">{s.customer.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{s.customer.phone}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic text-xs">Walk-in Customer</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {s.payments && s.payments.length > 0 ? (
                            s.payments.map((p, idx) => (
                              <Badge key={idx} variant="outline" className="text-[11px] uppercase font-mono">
                                {p.paymentMethod}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={isVoided ? "destructive" : "default"}
                          className={`text-xs font-normal ${
                            isVoided ? "bg-red-500/10 text-red-600 border-red-200 dark:border-red-800" : "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-800"
                          }`}
                        >
                          {isVoided ? strings.sales.statusVoided : strings.sales.statusCompleted}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-foreground whitespace-nowrap">
                        <span className={isVoided ? "line-through text-muted-foreground" : ""}>
                          {formatMoney(s.totalMinor)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Link href={`/sales/${s.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            {strings.sales.viewSale}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {strings.common.showing} {sales.length} {strings.common.of} {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                {strings.common.previous}
              </Button>
              <span className="text-xs text-foreground font-medium px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {strings.common.next}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
