"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  SlidersHorizontal,
  History,
  AlertTriangle,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

interface StockLevelItem {
  id: string;
  branchId: string;
  variantId: string;
  qty: number;
  reorderLevel?: number | null;
  branch?: {
    id: string;
    name: string;
    code?: string;
  };
  variant: {
    id: string;
    sku: string;
    priceMinor: number;
    reorderLevel?: number | null;
    barcodes: Array<{ id: string; barcode: string; isPrimary: boolean }>;
    product: {
      id: string;
      name: string;
      category?: { name: string } | null;
    };
    variantOptionValues?: Array<{
      optionValue: {
        value: string;
        option: { name: string };
      };
    }>;
    optionValues?: Array<{
      optionValue: {
        value: string;
        option: { name: string };
      };
    }>;
  };
}

interface MovementItem {
  id: string;
  branchId: string;
  variantId: string;
  type: string;
  qtyDelta: number;
  unitCostMinor?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  occurredAt: string;
  actorUserId?: string | null;
}

export default function StockLevelsPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals state
  const [adjustItem, setAdjustItem] = useState<StockLevelItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [historyItem, setHistoryItem] = useState<StockLevelItem | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: async () => {
      const res = await apiFetch("/branches");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  // Fetch stock levels
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-levels", selectedBranchId, searchTerm, lowStockOnly, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      if (searchTerm) params.set("search", searchTerm);
      if (lowStockOnly) params.set("lowStock", "true");
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await apiFetch(`/inventory/levels?${params.toString()}`);
      if (!res.ok) return { items: [], pagination: { total: 0, totalPages: 1 } };
      const json = await res.json();
      const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
      const pagination = json.meta?.pagination || json.data?.pagination || { total: items.length, totalPages: 1 };
      return { items, pagination };
    },
  });

  // Fetch movements for selected variant in modal
  const { data: movementsData = [], isLoading: loadingMovements } = useQuery({
    queryKey: ["stock-movements", historyItem?.variantId, historyItem?.branchId],
    enabled: !!historyItem,
    queryFn: async () => {
      if (!historyItem) return [];
      const params = new URLSearchParams();
      params.set("variantId", historyItem.variantId);
      if (historyItem.branchId) params.set("branchId", historyItem.branchId);
      params.set("limit", "50");

      const res = await apiFetch(`/inventory/movements?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : (json.data?.items || []);
    },
  });

  // Adjust stock mutation
  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!adjustItem) throw new Error("No variant selected");
      const delta = parseInt(adjustDelta, 10);
      if (isNaN(delta) || delta === 0) {
        throw new Error("সমন্বয়ের পরিমাণ ০ হতে পারবে না (Delta cannot be zero)");
      }
      if (!adjustReason.trim() || adjustReason.trim().length < 3) {
        throw new Error("সমন্বয়ের কারণ অন্তত ৩ অক্ষরের হতে হবে (Reason min 3 chars)");
      }

      const res = await apiFetch("/inventory/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: adjustItem.branchId,
          variantId: adjustItem.variantId,
          qtyDelta: delta,
          reason: adjustReason.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.errors?._errors?.[0] || "Stock adjustment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
      setActionSuccess("স্টক সফলভাবে সমন্বয় করা হয়েছে (Stock adjusted successfully)");
      setAdjustItem(null);
      setAdjustDelta("");
      setAdjustReason("");
      setAdjustError(null);
    },
    onError: (err: any) => {
      setAdjustError(err.message || "Failed to adjust stock");
    },
  });

  const items: StockLevelItem[] = stockData?.items || [];
  const pagination = stockData?.pagination || { total: 0, totalPages: 1 };

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{strings.inventory.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              সকল শাখার ভ্যারিয়েন্ট ভিত্তিক বর্তমান মজুদের তালিকা ও ইতিহাস
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hasPermission("inventory.manage") && (
              <Link href="/inventory/opening">
                <Button size="sm" variant="outline" className="flex items-center gap-1.5">
                  <PlusCircle className="h-4 w-4" />
                  <span>{strings.inventory.openingStockEntry}</span>
                </Button>
              </Link>
            )}
            {hasPermission("stock.adjust") && (
              <Link href="/inventory/adjustments">
                <Button size="sm" className="flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>{strings.inventory.adjustStock}</span>
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Success feedback */}
        {actionSuccess && (
          <div role="alert" data-testid="success-alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="ml-auto text-xs font-bold">✕</button>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="পণ্য, এসকেইউ (SKU) বা বারকোড দিয়ে খুঁজুন..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="pl-9 text-sm"
              data-testid="stock-search-input"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Branch selector */}
            <select
              value={selectedBranchId}
              onChange={(e) => {
                setSelectedBranchId(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="stock-branch-select"
            >
              <option value="">সকল শাখা (All Branches)</option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            {/* Low stock filter toggle */}
            <Button
              type="button"
              variant={lowStockOnly ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setLowStockOnly(!lowStockOnly);
                setPage(1);
              }}
              className="flex items-center gap-1.5 text-xs h-9"
              data-testid="low-stock-toggle"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{strings.inventory.lowStockThreshold}</span>
            </Button>
          </div>
        </div>

        {/* Stock Levels Table */}
        <div className="rounded-md border bg-card shadow-sm">
          <Table data-testid="stock-levels-table">
            <TableHeader>
              <TableRow>
                <TableHead>পণ্যের বিবরণ ও অপশন</TableHead>
                <TableHead className="w-[140px]">{strings.products.sku}</TableHead>
                <TableHead className="w-[160px]">{strings.products.barcode}</TableHead>
                <TableHead className="w-[120px]">শাখা</TableHead>
                <TableHead className="w-[120px] text-right">{strings.inventory.quantity}</TableHead>
                <TableHead className="w-[120px] text-right">{strings.inventory.reorderLevel}</TableHead>
                <TableHead className="w-[160px] text-right">{strings.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                    তথ্য লোড হচ্ছে...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                    কোন স্টক ডাটা পাওয়া যায়নি
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => {
                  const rawOpts = (item.variant as any).optionValues || item.variant.variantOptionValues || [];
                  const optionsLabel =
                    rawOpts.length > 0
                      ? rawOpts
                          .map((vov: any) => vov.optionValue?.value)
                          .filter(Boolean)
                          .join(" / ")
                      : (locale === "bn" ? "সাধারণ" : "Standard");

                  const reorderVal =
                    item.reorderLevel !== undefined && item.reorderLevel !== null
                      ? Number(item.reorderLevel)
                      : (item.variant?.reorderLevel !== undefined && item.variant?.reorderLevel !== null
                        ? Number(item.variant.reorderLevel)
                        : null);

                  const isAtOrBelowReorder = reorderVal !== null && Number(item.qty) <= reorderVal;
                  const isLow = isAtOrBelowReorder && Number(item.qty) > 0;
                  const isOut = Number(item.qty) <= 0;

                  return (
                    <TableRow
                      key={item.id}
                      data-testid="stock-level-row"
                      className={isAtOrBelowReorder ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/40"}
                    >
                      <TableCell>
                        <div className="font-semibold text-sm">{item.variant.product.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[11px] font-normal py-0">
                            {optionsLabel}
                          </Badge>
                          {item.variant.product.category && (
                            <span className="text-[11px] text-muted-foreground">
                              {item.variant.product.category.name}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-xs font-semibold">
                        {item.variant.sku}
                      </TableCell>

                      <TableCell className="text-xs font-mono">
                        {item.variant.barcodes && item.variant.barcodes.length > 0 ? (
                          item.variant.barcodes.map((b) => (
                            <div key={b.id} className="text-muted-foreground">
                              {b.barcode}
                            </div>
                          ))
                        ) : (
                          <span className="text-muted-foreground italic text-[11px]">বারকোড নেই</span>
                        )}
                      </TableCell>

                      <TableCell className="text-xs">
                        {item.branch ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{item.branch.name}</span>
                            {item.branch.code && (
                              <span className="text-[11px] font-mono text-muted-foreground">{item.branch.code}</span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono ${
                            isOut
                              ? "bg-destructive/15 text-destructive"
                              : isLow
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          }`}
                          data-testid="stock-qty-badge"
                        >
                          {item.qty}
                        </span>
                      </TableCell>

                      <TableCell className="text-right text-xs font-mono">
                        {reorderVal !== null ? (
                          <span className={isAtOrBelowReorder ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}>
                            {reorderVal}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {hasPermission("stock.adjust") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2"
                              onClick={() => {
                                setAdjustItem(item);
                                setAdjustDelta("");
                                setAdjustReason("");
                                setAdjustError(null);
                              }}
                              data-testid="btn-adjust-row"
                            >
                              সমন্বয়
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2 text-muted-foreground"
                            onClick={() => setHistoryItem(item)}
                            data-testid="btn-history-row"
                          >
                            <History className="h-3.5 w-3.5 mr-1" />
                            ইতিহাস
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                মোট {pagination.total} টি রেকর্ড • পৃষ্ঠা {pagination.page} এর {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  পূর্ববর্তী
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  পরবর্তী
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Stock Adjustment Dialog */}
        <Dialog open={!!adjustItem} onOpenChange={(open) => !open && setAdjustItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">
                {strings.inventory.adjustStock}
              </DialogTitle>
            </DialogHeader>

            {adjustItem && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                  <div className="font-semibold text-sm">{adjustItem.variant.product.name}</div>
                  <div className="text-muted-foreground">
                    এসকেইউ: <span className="font-mono font-medium">{adjustItem.variant.sku}</span> • শাখা: {adjustItem.branch?.name}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span>{strings.inventory.currentStock}:</span>
                    <Badge variant="secondary" className="font-bold">
                      {adjustItem.qty}
                    </Badge>
                  </div>
                </div>

                {adjustError && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{adjustError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="adjustDeltaInput" className="text-xs font-semibold">
                    {strings.inventory.adjustmentDelta} (যোগ করার জন্য ধণাত্মক, কমাতে ঋণাত্মক সংখ্যা)
                  </Label>
                  <Input
                    id="adjustDeltaInput"
                    data-testid="adjust-delta-input"
                    type="number"
                    placeholder="যেমন: 5 অথবা -2"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    className="h-9 text-sm"
                  />
                  {adjustDelta && !isNaN(parseInt(adjustDelta, 10)) && (
                    <p className="text-xs text-muted-foreground">
                      সমন্বয়ের পর নতুন মজুদ হবে:{" "}
                      <span className="font-bold text-foreground">
                        {adjustItem.qty + parseInt(adjustDelta, 10)}
                      </span>
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adjustReasonInput" className="text-xs font-semibold">
                    {strings.inventory.adjustmentReason} (বাধ্যতামূলক, যেমন: নষ্ট পণ্য, গণনা সংশোধন) *
                  </Label>
                  <Input
                    id="adjustReasonInput"
                    data-testid="adjust-reason-input"
                    placeholder="সমন্বয়ের কারণ লিখুন..."
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setAdjustItem(null)}>
                বাতিল
              </Button>
              <Button
                size="sm"
                data-testid="btn-save-adjustment"
                disabled={adjustMutation.isPending || !adjustDelta || !adjustReason.trim()}
                onClick={() => adjustMutation.mutate()}
              >
                {adjustMutation.isPending ? "সংরক্ষণ হচ্ছে..." : strings.inventory.confirmAdjustment}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Movement History Dialog */}
        <Dialog open={!!historyItem} onOpenChange={(open) => !open && setHistoryItem(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center justify-between">
                <span>{strings.inventory.movementHistory}</span>
                {historyItem && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {historyItem.variant.sku}
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>

            <div className="overflow-y-auto flex-1 my-2">
              <Table data-testid="movements-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{strings.inventory.movementDate}</TableHead>
                    <TableHead className="text-xs">{strings.inventory.movementType}</TableHead>
                    <TableHead className="text-xs text-right">{strings.inventory.qtyDelta}</TableHead>
                    <TableHead className="text-xs">{strings.inventory.adjustmentReason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMovements ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
                        লোড হচ্ছে...
                      </TableCell>
                    </TableRow>
                  ) : !movementsData || movementsData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
                        কোন লেনদেন পাওয়া যায়নি
                      </TableCell>
                    </TableRow>
                  ) : (
                    movementsData.map((m: MovementItem) => {
                      const isPositive = m.qtyDelta > 0;
                      return (
                        <TableRow key={m.id} data-testid="movement-row">
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(m.occurredAt).toLocaleString("bn-BD")}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px] font-medium">
                              {m.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right font-bold">
                            <span className={isPositive ? "text-emerald-600" : "text-destructive"}>
                              {isPositive ? `+${m.qtyDelta}` : m.qtyDelta}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {m.reason || (m.referenceType ? `${m.referenceType}: ${m.referenceId?.slice(0, 8)}...` : "-")}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setHistoryItem(null)}>
                বন্ধ করুন
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
