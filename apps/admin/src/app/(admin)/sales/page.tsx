"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-picker";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { formatPaymentMethod, formatSaleStatus } from "@/i18n/formatters";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { Search, Eye, RefreshCw, X } from "lucide-react";

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
  const router = useRouter();
  const { apiFetch, currentBranch } = useAuth();
  const { strings, locale } = useTranslation();

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
  const [pageSize, setPageSize] = useState(25);
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
      const effectiveBranchId = branchFilter !== "all" ? branchFilter : (currentBranch?.id || "");
      if (effectiveBranchId) queryParams.set("branchId", effectiveBranchId);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);
      if (paymentFilter && paymentFilter !== "all") queryParams.set("paymentMethod", paymentFilter);
      if (startDate) queryParams.set("startDate", new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        queryParams.set("endDate", end.toISOString());
      }
      queryParams.set("page", page.toString());
      queryParams.set("limit", pageSize.toString());

      const res = await apiFetch(`/sales?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setSales(items);
        if (json.data?.meta) {
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage(strings.common.error);
      }
    } catch {
      setErrorMessage(strings.common.error);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, search, branchFilter, currentBranch?.id, statusFilter, paymentFilter, startDate, endDate, page, pageSize, strings.common.error]);

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
    search !== "" ||
    branchFilter !== "all" ||
    statusFilter !== "all" ||
    paymentFilter !== "all" ||
    startDate !== "" ||
    endDate !== "";

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {strings.sales.title}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {strings.sales.subtitle}
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search by Receipt */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={strings.sales.searchReceiptPlaceholder}
              className="pl-9 h-9 text-xs sm:text-sm"
            />
          </div>

          {/* Branch Filter */}
          <div>
            <Select
              value={branchFilter}
              onValueChange={(val) => {
                setBranchFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allBranches}>
                <SelectValue placeholder={strings.selectEmpty.allBranches} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                  {strings.selectEmpty.allBranches}
                </SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs sm:text-sm">
                    {b.name} ({b.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div>
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allStatuses}>
                <SelectValue placeholder={strings.selectEmpty.allStatuses} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                  {strings.selectEmpty.allStatuses}
                </SelectItem>
                <SelectItem value="completed" className="text-xs sm:text-sm">
                  {strings.enums.saleStatus.completed}
                </SelectItem>
                <SelectItem value="voided" className="text-xs sm:text-sm">
                  {strings.enums.saleStatus.voided}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment Method Filter */}
          <div>
            <Select
              value={paymentFilter}
              onValueChange={(val) => {
                setPaymentFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allPaymentMethods}>
                <SelectValue placeholder={strings.selectEmpty.allPaymentMethods} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                  {strings.selectEmpty.allPaymentMethods}
                </SelectItem>
                <SelectItem value="cash" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.cash}
                </SelectItem>
                <SelectItem value="card" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.card}
                </SelectItem>
                <SelectItem value="bkash" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.bkash}
                </SelectItem>
                <SelectItem value="nagad" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.nagad}
                </SelectItem>
                <SelectItem value="rocket" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.rocket}
                </SelectItem>
                <SelectItem value="bank_transfer" className="text-xs sm:text-sm">
                  {strings.enums.paymentMethod.bank_transfer}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Date Range & Clear */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: s, endDate: e }) => {
                setStartDate(s);
                setEndDate(e);
                setPage(1);
              }}
              placeholder={locale === "bn" ? "তারিখ বেছে নিন" : "Choose date range"}
            />
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground h-8"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              {strings.sales.clearFilters}
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Sales List Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">{strings.sales.receiptNumber}</TableHead>
              <TableHead className="w-44">{strings.sales.dateTime}</TableHead>
              <TableHead>{strings.sales.customer}</TableHead>
              <TableHead>{strings.sales.paymentMethod}</TableHead>
              <TableHead className="text-center w-28">{strings.common.status}</TableHead>
              <TableHead className="text-right w-36">{strings.sales.total}</TableHead>
              <TableHead className="text-right w-20">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  {strings.common.loading}
                </TableCell>
              </TableRow>
            ) : sales.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  {strings.common.noData}
                </TableCell>
              </TableRow>
            ) : (
              sales.map((s) => {
                const isVoided = s.status === "voided";
                return (
                  <TableRow
                    key={s.id}
                    onClick={() => router.push(`/sales/${s.id}`)}
                    className="cursor-pointer hover:bg-muted/30 h-[56px] transition-colors"
                  >
                    <TableCell className="font-mono font-semibold text-xs sm:text-sm text-foreground">
                      <Link href={`/sales/${s.id}`} className="hover:underline">
                        {s.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono tabular-nums whitespace-nowrap">
                      {formatDateTime(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-foreground text-xs">
                      {s.customer && s.customer.name !== "Walk-in Customer" ? (
                        <div>
                          <span className="font-medium block text-foreground">{s.customer.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">{s.customer.phone}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">
                          {strings.enums.customer.walkIn}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.payments && s.payments.length > 0 ? (
                          s.payments.map((p, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] font-medium">
                              {formatPaymentMethod(p.paymentMethod, strings)}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={isVoided ? "destructive" : "success"}
                        className="text-[11px]"
                      >
                        {formatSaleStatus(s.status, strings)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground text-xs sm:text-sm whitespace-nowrap">
                      <span className={isVoided ? "line-through text-muted-foreground" : ""}>
                        {formatMoney(s.totalMinor)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Link href={`/sales/${s.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          <span>{strings.common.details}</span>
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
