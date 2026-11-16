"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
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
import { formatMoney, formatDateTime } from "@/lib/utils";
import { formatShiftStatus } from "@/i18n/formatters";
import {
  Clock,
  Eye,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

interface ShiftRecord {
  id: string;
  status: string;
  openingCashMinor: number;
  closingCashMinor?: number | null;
  expectedCashMinor?: number | null;
  cashDifferenceMinor?: number | null;
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  register?: {
    id: string;
    name: string;
    code: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  cashierUser?: {
    id: string;
    name: string;
  } | null;
}

interface Register {
  id: string;
  name: string;
  code: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function ShiftsPage() {
  const router = useRouter();
  const { apiFetch, currentBranch } = useAuth();
  const { strings } = useTranslation();

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [branchFilter, setBranchFilter] = useState("all");
  const [registerFilter, setRegisterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load branches & registers for filters
  useEffect(() => {
    let isCurrent = true;
    async function loadMetadata() {
      try {
        const [bRes, rRes] = await Promise.all([
          apiFetch("/branches"),
          apiFetch("/registers"),
        ]);
        if (isCurrent) {
          if (bRes.ok) {
            const bJson = await bRes.json();
            setBranches(Array.isArray(bJson.data) ? bJson.data : (bJson.data?.items || []));
          }
          if (rRes.ok) {
            const rJson = await rRes.json();
            setRegisters(Array.isArray(rJson.data) ? rJson.data : (rJson.data?.items || []));
          }
        }
      } catch {
        // Ignore
      }
    }
    loadMetadata();
    return () => {
      isCurrent = false;
    };
  }, [apiFetch]);

  const fetchShifts = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const queryParams = new URLSearchParams();
      const effectiveBranchId = branchFilter !== "all" ? branchFilter : (currentBranch?.id || "");
      if (effectiveBranchId) queryParams.set("branchId", effectiveBranchId);
      if (registerFilter && registerFilter !== "all") queryParams.set("registerId", registerFilter);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);
      queryParams.set("page", page.toString());
      queryParams.set("limit", pageSize.toString());

      const res = await apiFetch(`/shifts?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setShifts(items);
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
  }, [apiFetch, branchFilter, currentBranch?.id, registerFilter, statusFilter, page, pageSize, strings.common.error]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            <span>{strings.shifts.title}</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {strings.shifts.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchShifts()} disabled={loading} className="h-9">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            <span>{strings.common.refresh}</span>
          </Button>
        </div>
      </div>

      {/* Notice */}
      <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-xs text-muted-foreground flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <span>{strings.shifts.readOnlyNotice}</span>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

          {/* Register Filter */}
          <div>
            <Select
              value={registerFilter}
              onValueChange={(val) => {
                setRegisterFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allRegisters}>
                <SelectValue placeholder={strings.selectEmpty.allRegisters} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                  {strings.selectEmpty.allRegisters}
                </SelectItem>
                {registers.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs sm:text-sm">
                    {r.name} ({r.code})
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
                <SelectItem value="open" className="text-xs sm:text-sm">
                  {strings.enums.shiftStatus.open}
                </SelectItem>
                <SelectItem value="closed" className="text-xs sm:text-sm">
                  {strings.enums.shiftStatus.closed}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">{strings.shifts.register}</TableHead>
              <TableHead className="w-36">{strings.sales.cashier}</TableHead>
              <TableHead className="text-center w-24">{strings.common.status}</TableHead>
              <TableHead className="w-44">{strings.shifts.openedAt}</TableHead>
              <TableHead className="text-right w-32">{strings.shifts.openingCash}</TableHead>
              <TableHead className="text-right w-32">{strings.shifts.countedCash}</TableHead>
              <TableHead className="text-right w-32">{strings.shifts.difference}</TableHead>
              <TableHead className="text-right w-20">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  {strings.common.loading}
                </TableCell>
              </TableRow>
            ) : shifts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  {strings.common.noData}
                </TableCell>
              </TableRow>
            ) : (
              shifts.map((s) => {
                const isOpen = s.status === "open";
                const diff = s.cashDifferenceMinor !== undefined && s.cashDifferenceMinor !== null
                  ? Number(s.cashDifferenceMinor)
                  : null;

                return (
                  <TableRow
                    key={s.id}
                    onClick={() => router.push(`/shifts/${s.id}`)}
                    className="cursor-pointer hover:bg-muted/30 h-[56px] transition-colors"
                  >
                    <TableCell>
                      <span className="font-semibold text-foreground text-xs sm:text-sm block">
                        {s.register?.name || "Station"}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {s.register?.code || s.id.slice(0, 8)}
                      </span>
                    </TableCell>

                    <TableCell className="text-foreground text-xs font-medium">
                      {s.cashierUser?.name || "Cashier"}
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge
                        variant={isOpen ? "success" : "secondary"}
                        className="text-[11px]"
                      >
                        {formatShiftStatus(s.status, strings)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-muted-foreground text-xs font-mono tabular-nums whitespace-nowrap">
                      {formatDateTime(s.openedAt)}
                    </TableCell>

                    <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground text-xs sm:text-sm whitespace-nowrap">
                      {formatMoney(s.openingCashMinor)}
                    </TableCell>

                    <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground text-xs sm:text-sm whitespace-nowrap">
                      {s.closingCashMinor !== null && s.closingCashMinor !== undefined
                        ? formatMoney(s.closingCashMinor)
                        : "—"}
                    </TableCell>

                    <TableCell className="text-right font-mono tabular-nums text-xs sm:text-sm whitespace-nowrap">
                      {diff !== null ? (
                        <span
                          className={
                            diff === 0
                              ? "text-foreground font-medium"
                              : diff < 0
                              ? "text-rose-700 dark:text-rose-400 font-semibold"
                              : "text-foreground font-semibold"
                          }
                        >
                          {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Link href={`/shifts/${s.id}`}>
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
