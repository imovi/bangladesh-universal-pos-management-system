"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import { DataTablePagination } from "@/components/common/data-table-pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { formatPaymentMethod } from "@/i18n/formatters";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { Search, Eye, RotateCcw } from "lucide-react";

interface SaleReturnItem {
  id: string;
  quantity: number;
  condition: string;
  totalRefundMinor: number;
}

interface SaleReturnRecord {
  id: string;
  returnNumber: string;
  refundMethod: string;
  totalRefundMinor: number;
  reason?: string | null;
  overrideReason?: string | null;
  createdAt: string;
  sale?: {
    id: string;
    invoiceNumber: string;
    customer?: {
      id: string;
      name: string;
      phone: string;
    } | null;
  } | null;
  cashierUser?: {
    id: string;
    name: string;
  } | null;
  branch?: {
    id: string;
    name: string;
  } | null;
  items?: SaleReturnItem[];
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function SaleReturnsPage() {
  const { apiFetch, currentBranch } = useAuth();
  const { strings, locale } = useTranslation();

  const [returns, setReturns] = useState<SaleReturnRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [refundMethodFilter, setRefundMethodFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    async function loadBranches() {
      try {
        const res = await apiFetch("/branches");
        if (res.ok) {
          const json = await res.json();
          if (isCurrent) {
            setBranches(Array.isArray(json.data) ? json.data : json.data?.items || []);
          }
        }
      } catch {
        // Ignore
      }
    }
    loadBranches();
    return () => {
      isCurrent = false;
    };
  }, [apiFetch]);

  const fetchReturns = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);
      const effectiveBranchId = branchFilter !== "all" ? branchFilter : currentBranch?.id || "";
      if (effectiveBranchId) queryParams.set("branchId", effectiveBranchId);
      if (refundMethodFilter && refundMethodFilter !== "all") {
        queryParams.set("refundMethod", refundMethodFilter);
      }
      if (startDate) queryParams.set("startDate", new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        queryParams.set("endDate", end.toISOString());
      }
      queryParams.set("page", page.toString());
      queryParams.set("limit", pageSize.toString());

      const res = await apiFetch(`/sales/returns?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : json.data?.items || [];
        setReturns(items);
        if (json.data?.meta) {
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage(strings.common?.error || "Error loading returns");
      }
    } catch {
      setErrorMessage(strings.common?.error || "Error loading returns");
    } finally {
      setLoading(false);
    }
  }, [
    apiFetch,
    branchFilter,
    currentBranch?.id,
    endDate,
    page,
    pageSize,
    refundMethodFilter,
    search,
    startDate,
    strings.common?.error,
  ]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-amber-600" />
            {locale === "bn" ? "পণ্য ফেরত তালিকা" : "Returns & Exchanges"}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {locale === "bn"
              ? "ফেরত লেনদেন, বদল এবং রিফান্ড অডিট দেখুন"
              : "Track product returns, exchanges and refund audits"}
          </p>
        </div>
        <div>
          <Link href="/pos">
            <Button variant="outline">
              {locale === "bn" ? "পিওএস স্ক্রিনে যান" : "Go to POS"}
            </Button>
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {errorMessage}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
            <Input
              placeholder={locale === "bn" ? "ফেরত বা ইনভয়েস নম্বর..." : "Return or invoice #..."}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>

          <Select
            value={branchFilter}
            onValueChange={(val) => {
              setBranchFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={locale === "bn" ? "সকল শাখা" : "All Branches"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{locale === "bn" ? "সকল শাখা" : "All Branches"}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={refundMethodFilter}
            onValueChange={(val) => {
              setRefundMethodFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={locale === "bn" ? "সকল রিফান্ড মাধ্যম" : "All Refund Methods"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {locale === "bn" ? "সকল রিফান্ড মাধ্যম" : "All Refund Methods"}
              </SelectItem>
              <SelectItem value="cash">{formatPaymentMethod("cash", strings)}</SelectItem>
              <SelectItem value="card">{formatPaymentMethod("card", strings)}</SelectItem>
              <SelectItem value="bkash">{formatPaymentMethod("bkash", strings)}</SelectItem>
              <SelectItem value="nagad">{formatPaymentMethod("nagad", strings)}</SelectItem>
              <SelectItem value="other">{formatPaymentMethod("other", strings)}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
            <span className="text-neutral-400">-</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "bn" ? "ফেরত নম্বর" : "Return #"}</TableHead>
              <TableHead>{locale === "bn" ? "মূল ইনভয়েস" : "Original Invoice"}</TableHead>
              <TableHead>{locale === "bn" ? "ক্যাশিয়ার" : "Cashier"}</TableHead>
              <TableHead>{locale === "bn" ? "রিফান্ড মাধ্যম" : "Refund Method"}</TableHead>
              <TableHead className="text-right">{locale === "bn" ? "মোট রিফান্ড" : "Total Refund"}</TableHead>
              <TableHead>{locale === "bn" ? "সময়" : "Date & Time"}</TableHead>
              <TableHead className="text-right">{locale === "bn" ? "অ্যাকশন" : "Action"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-neutral-500">
                  {strings.common?.loading || "Loading..."}
                </TableCell>
              </TableRow>
            ) : returns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-neutral-500">
                  {locale === "bn" ? "কোন পণ্য ফেরত পাওয়া যায়নি" : "No returns found"}
                </TableCell>
              </TableRow>
            ) : (
              returns.map((ret) => (
                <TableRow key={ret.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <TableCell className="font-mono font-medium text-neutral-900 dark:text-neutral-100">
                    <Link
                      href={`/sales/returns/${ret.id}`}
                      className="text-primary hover:underline"
                    >
                      {ret.returnNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {ret.sale ? (
                      <Link
                        href={`/sales/${ret.sale.id}`}
                        className="text-neutral-600 dark:text-neutral-400 hover:underline"
                      >
                        {ret.sale.invoiceNumber}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-600 dark:text-neutral-400">
                    {ret.cashierUser?.name || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {formatPaymentMethod(ret.refundMethod, strings)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                    -{formatMoney(ret.totalRefundMinor)}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 whitespace-nowrap">
                    {formatDateTime(ret.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/sales/returns/${ret.id}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        {locale === "bn" ? "বিস্তারিত" : "View"}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
