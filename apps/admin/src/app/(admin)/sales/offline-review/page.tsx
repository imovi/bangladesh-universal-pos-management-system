"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  RefreshCw,
  ExternalLink,
  X,
  FileCheck,
} from "lucide-react";

interface ReviewFlag {
  id: string;
  saleId: string;
  flag: string;
  details?: any;
  status: "open" | "resolved";
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  sale?: {
    id: string;
    invoiceNumber: string;
    totalMinor: number;
    branch?: { id: string; name: string; code: string };
    cashierUser?: { id: string; name: string; email: string };
    items?: Array<{
      id: string;
      quantity: number;
      variant?: {
        sku: string;
        product?: { name: string };
      };
    }>;
  };
  resolvedByUser?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export default function OfflineReviewPage() {
  const { apiFetch, currentBranch } = useAuth();
  const { strings } = useTranslation();
  const t = strings.offlineReview;
  const c = strings.common;

  const [flags, setFlags] = useState<ReviewFlag[]>([]);
  const [, setTotalCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [flagTypeFilter, setFlagTypeFilter] = useState<string>("all");

  // Resolve Modal
  const [selectedFlag, setSelectedFlag] = useState<ReviewFlag | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [isSubmittingResolve, setIsSubmittingResolve] = useState(false);
  const [resolveSuccessMsg, setResolveSuccessMsg] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (flagTypeFilter !== "all") params.set("flag", flagTypeFilter);
      if (currentBranch?.id) params.set("branchId", currentBranch.id);

      const res = await apiFetch(`/sales/offline-review?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const list = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.data?.items)
        ? json.data.items
        : Array.isArray(json.data?.data)
        ? json.data.data
        : [];
      setFlags(list);
      setTotalCount(json.meta?.total ?? json.data?.meta?.total ?? list.length);

      // Also get count of open flags
      const countRes = await apiFetch("/sales/offline-review/count");
      if (countRes.ok) {
        const countJson = await countRes.json();
        const cnt = countJson.data?.count ?? countJson.count ?? 0;
        setOpenCount(cnt);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load review flags");
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, statusFilter, flagTypeFilter, currentBranch?.id]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFlag) return;

    setIsSubmittingResolve(true);
    try {
      const res = await apiFetch(`/sales/offline-review/${selectedFlag.id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNotes: resolutionNotes.trim() || undefined }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Failed to resolve flag");
      }

      setResolveSuccessMsg(t.resolveSuccess);
      setTimeout(() => setResolveSuccessMsg(null), 4000);
      setSelectedFlag(null);
      setResolutionNotes("");
      fetchFlags();
    } catch (err: any) {
      alert(err.message || "Error resolving flag");
    } finally {
      setIsSubmittingResolve(false);
    }
  };

  const getFlagBadge = (flagType: string) => {
    switch (flagType) {
      case "PRICE_CHANGED":
      case "PRICE_UNKNOWN":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-mono text-[11px]">
            {t.flagPriceChanged}
          </Badge>
        );
      case "OUT_OF_STOCK_NEGATIVE":
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20 font-mono text-[11px]">
            {t.flagNegativeStock}
          </Badge>
        );
      case "CUSTOMER_CREDIT_EXCEEDED":
        return (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20 font-mono text-[11px]">
            CUSTOMER_CREDIT_EXCEEDED
          </Badge>
        );
      case "NUMBER_MISMATCH":
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 font-mono text-[11px]">
            {t.flagNumberMismatch}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-mono text-[11px]">
            {flagType}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t.title}
            </h1>
            {openCount > 0 && (
              <Badge
                data-testid="open-review-flags-badge"
                className="bg-amber-500 text-white font-mono text-xs px-2 py-0.5"
              >
                {openCount} {t.openFlags}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t.subtitle}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchFlags}
          disabled={isLoading}
          className="h-9 gap-1.5 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          <span>{t.refresh}</span>
        </Button>
      </div>

      {resolveSuccessMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{resolveSuccessMsg}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card border border-border rounded-xl shadow-xs">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>{t.filterStatus}:</span>
        </div>

        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="status-filter-select" className="h-8 text-xs">
              <SelectValue placeholder={t.filterStatus} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filterAllStatus}</SelectItem>
              <SelectItem value="open">{t.filterOpen}</SelectItem>
              <SelectItem value="resolved">{t.filterResolved}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-48">
          <Select value={flagTypeFilter} onValueChange={setFlagTypeFilter}>
            <SelectTrigger data-testid="flag-filter-select" className="h-8 text-xs">
              <SelectValue placeholder={t.filterFlag} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filterAllFlags}</SelectItem>
              <SelectItem value="PRICE_CHANGED">{t.flagPriceChanged}</SelectItem>
              <SelectItem value="OUT_OF_STOCK_NEGATIVE">{t.flagNegativeStock}</SelectItem>
              <SelectItem value="CATALOG_STALE">{t.flagCatalogStale}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>{c.loading}</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive text-sm">{error}</div>
        ) : flags.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileCheck className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="text-base font-semibold text-foreground">
              {t.noFlagsFound}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.subtitle}
            </p>
          </div>
        ) : (
          <Table data-testid="offline-review-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t.tableInvoice}</TableHead>
                <TableHead>{c.date}</TableHead>
                <TableHead>{t.tableCashierBranch}</TableHead>
                <TableHead>{t.tableFlagType}</TableHead>
                <TableHead>{t.tableDetails}</TableHead>
                <TableHead>{t.tableStatus}</TableHead>
                <TableHead className="text-right">{t.tableActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((item) => (
                <TableRow key={item.id} data-testid="review-flag-row">
                  <TableCell className="font-mono font-bold text-xs">
                    {item.sale?.invoiceNumber ? (
                      <Link
                        href={`/sales/${item.sale.id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <span>{item.sale.invoiceNumber}</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      item.saleId
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(item.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <p className="font-medium text-foreground">{item.sale?.cashierUser?.name || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{item.sale?.branch?.name || "—"}</p>
                  </TableCell>
                  <TableCell>{getFlagBadge(item.flag)}</TableCell>
                  <TableCell className="text-xs max-w-xs">
                    {item.details ? (
                      typeof item.details === "string" ? (
                        item.details
                      ) : item.details.reason ? (
                        item.details.reason
                      ) : (
                        <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-1 rounded">
                          {JSON.stringify(item.details)}
                        </pre>
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {item.status === "resolved" ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs font-semibold">
                        {t.statusResolved}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs font-semibold">
                        {t.statusOpen}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === "open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="resolve-flag-button"
                        onClick={() => {
                          setSelectedFlag(item);
                          setResolutionNotes("");
                        }}
                        className="h-7 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10"
                      >
                        {t.resolveButton}
                      </Button>
                    ) : (
                      <div className="text-[11px] text-muted-foreground text-right">
                        <span>{item.resolvedByUser?.name || "Manager"}</span>
                        {item.resolutionNotes && (
                          <p className="text-[10px] italic truncate max-w-[140px] ml-auto">
                            "{item.resolutionNotes}"
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Resolve Modal */}
      {selectedFlag && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="resolve-flag-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="font-bold text-base text-foreground">
                  {t.resolveModalTitle}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedFlag(null)}
                className="h-8 w-8 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2 text-xs bg-muted/30 p-3 rounded-xl border border-border">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.invoiceLabel}:</span>
                <span className="font-mono font-bold">{selectedFlag.sale?.invoiceNumber || selectedFlag.saleId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.flagTypeLabel}:</span>
                <span>{getFlagBadge(selectedFlag.flag)}</span>
              </div>
            </div>

            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {t.resolutionNotesLabel}:
                </label>
                <textarea
                  data-testid="resolution-notes-input"
                  required
                  rows={3}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder={t.resolutionNotesPlaceholder}
                  className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFlag(null)}
                  disabled={isSubmittingResolve}
                >
                  {c.cancel}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="submit-resolve-button"
                  disabled={isSubmittingResolve || !resolutionNotes.trim()}
                  className="font-semibold"
                >
                  {isSubmittingResolve ? c.loading : t.confirmResolve}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
