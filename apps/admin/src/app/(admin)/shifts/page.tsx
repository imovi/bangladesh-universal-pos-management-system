"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Eye,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

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
  const { apiFetch } = useAuth();
  const { strings } = useTranslation();

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [branchFilter, setBranchFilter] = useState("all");
  const [registerFilter, setRegisterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
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
      if (branchFilter && branchFilter !== "all") queryParams.set("branchId", branchFilter);
      if (registerFilter && registerFilter !== "all") queryParams.set("registerId", registerFilter);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);
      queryParams.set("page", page.toString());
      queryParams.set("limit", "20");

      const res = await apiFetch(`/shifts?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setShifts(items);
        if (json.data?.meta) {
          setTotalPages(json.data.meta.totalPages || 1);
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage("Failed to load shifts");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, branchFilter, registerFilter, statusFilter, page]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            {strings.shifts.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.shifts.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchShifts()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {strings.common.refresh}
          </Button>
        </div>
      </div>

      {/* Notice */}
      <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-xs text-muted-foreground flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <span>{strings.shifts.readOnlyNotice}</span>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <option value="all">{strings.shifts.filterBranch}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          {/* Register Filter */}
          <div>
            <select
              value={registerFilter}
              onChange={(e) => {
                setRegisterFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="all">{strings.shifts.filterRegister}</option>
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
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
              <option value="all">{strings.shifts.filterStatus}</option>
              <option value="open">{strings.shifts.statusOpen}</option>
              <option value="closed">{strings.shifts.statusClosed}</option>
            </select>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="py-3 px-4">{strings.shifts.register}</th>
                <th className="py-3 px-4">{strings.sales.cashier}</th>
                <th className="py-3 px-4 text-center">{strings.common.status}</th>
                <th className="py-3 px-4">{strings.shifts.openedAt}</th>
                <th className="py-3 px-4 text-right">{strings.shifts.openingCash}</th>
                <th className="py-3 px-4 text-right">{strings.shifts.countedCash}</th>
                <th className="py-3 px-4 text-right">{strings.shifts.difference}</th>
                <th className="py-3 px-4 text-center">{strings.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    {strings.common.loading}
                  </td>
                </tr>
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    {strings.common.noData}
                  </td>
                </tr>
              ) : (
                shifts.map((s) => {
                  const isOpen = s.status === "open";
                  const diff = s.cashDifferenceMinor !== undefined && s.cashDifferenceMinor !== null
                    ? Number(s.cashDifferenceMinor)
                    : null;

                  return (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <Link href={`/shifts/${s.id}`} className="font-medium text-foreground hover:underline text-primary block">
                          {s.register?.name || "Station"}
                        </Link>
                        <span className="text-xs text-muted-foreground font-mono">
                          {s.register?.code || s.id.slice(0, 8)}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-foreground font-medium">
                        {s.cashierUser?.name || "Cashier"}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={isOpen ? "default" : "secondary"}
                          className={`text-xs font-normal ${
                            isOpen
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-200 animate-pulse"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isOpen ? strings.shifts.statusOpen : strings.shifts.statusClosed}
                        </Badge>
                      </td>

                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(s.openedAt).toLocaleDateString()} {new Date(s.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>

                      <td className="py-3 px-4 text-right font-medium text-foreground whitespace-nowrap">
                        {formatMoney(s.openingCashMinor)}
                      </td>

                      <td className="py-3 px-4 text-right font-medium text-foreground whitespace-nowrap">
                        {s.closingCashMinor !== null && s.closingCashMinor !== undefined
                          ? formatMoney(s.closingCashMinor)
                          : "-"}
                      </td>

                      <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                        {diff !== null ? (
                          <span
                            className={
                              diff === 0
                                ? "text-emerald-600 font-semibold"
                                : diff < 0
                                ? "text-destructive font-semibold"
                                : "text-blue-600 font-semibold"
                            }
                          >
                            {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <Link href={`/shifts/${s.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            {strings.shifts.viewShift}
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {strings.common.showing} {shifts.length} {strings.common.of} {totalCount}
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
