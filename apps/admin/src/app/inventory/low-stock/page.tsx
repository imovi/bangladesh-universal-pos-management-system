"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
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
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

export default function LowStockPage() {
  const { strings } = useTranslation();
  const { apiFetch, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals state
  const [adjustItem, setAdjustItem] = useState<any | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
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

  // Fetch low stock items
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["low-stock-levels", selectedBranchId, searchTerm, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      if (searchTerm) params.set("search", searchTerm);
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await apiFetch(`/inventory/low-stock?${params.toString()}`);
      if (!res.ok) return { items: [], pagination: { total: 0, totalPages: 1 } };
      const json = await res.json();
      const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
      const pagination = json.meta?.pagination || json.data?.pagination || { total: items.length, totalPages: 1 };
      return { items, pagination };
    },
  });

  // Adjust stock mutation
  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!adjustItem) throw new Error("No variant selected");
      const delta = parseInt(adjustDelta, 10);
      if (isNaN(delta) || delta === 0) {
        throw new Error("সমন্বয়ের পরিমাণ ০ হতে পারবে না");
      }
      if (!adjustReason.trim() || adjustReason.trim().length < 3) {
        throw new Error("সমন্বয়ের কারণ অন্তত ৩ অক্ষরের হতে হবে");
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
        throw new Error(errJson.message || "Failed to adjust stock");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["low-stock-levels"] });
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
      setActionSuccess("স্টক সফলভাবে সমন্বয় করা হয়েছে");
      setAdjustItem(null);
      setAdjustDelta("");
      setAdjustReason("");
      setAdjustError(null);
    },
    onError: (err: any) => {
      setAdjustError(err.message || "Failed to adjust stock");
    },
  });

  const items = stockData?.items || [];
  const pagination = stockData?.pagination || { total: 0, totalPages: 1 };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/inventory/stock">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <span>{strings.inventory.lowStockThreshold}</span>
                <Badge variant="destructive" className="text-xs">
                  {pagination.total} টি সতর্কতা
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                যে সকল ভ্যারিয়েন্টের স্টক পুনঃঅর্ডারের সীমা অতিক্রম করেছে বা শূন্য
              </p>
            </div>
          </div>

          {hasPermission("stock.adjust") && (
            <Link href="/inventory/adjustments">
              <Button size="sm" className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-4 w-4" />
                <span>{strings.inventory.adjustStock}</span>
              </Button>
            </Link>
          )}
        </div>

        {actionSuccess && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="ml-auto text-xs font-bold">✕</button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="পণ্য, এসকেইউ বা বারকোড দিয়ে খুঁজুন..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="pl-9 text-sm"
            />
          </div>

          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">সকল শাখা (All Branches)</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>পণ্যের বিবরণ ও অপশন</TableHead>
                <TableHead className="w-[140px]">{strings.products.sku}</TableHead>
                <TableHead className="w-[140px]">শাখা</TableHead>
                <TableHead className="w-[120px] text-right">{strings.inventory.quantity}</TableHead>
                <TableHead className="w-[120px] text-right">{strings.inventory.reorderLevel}</TableHead>
                <TableHead className="w-[120px] text-center">স্ট্যাটাস</TableHead>
                <TableHead className="w-[120px] text-right">{strings.common.actions}</TableHead>
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
                    কোন কম স্টকের পণ্য নেই। সকল পণ্যে পর্যাপ্ত মজুদ রয়েছে!
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item: any) => {
                  const rawOpts = item.variant.optionValues || item.variant.variantOptionValues || [];
                  const optionsLabel = rawOpts.length > 0
                    ? rawOpts.map((vov: any) => `${vov.optionValue?.option?.name || ""}: ${vov.optionValue?.value || ""}`).join(", ")
                    : "Standard";

                  const isOut = item.qty <= 0;

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-semibold text-sm">{item.variant.product.name}</div>
                        <Badge variant="outline" className="text-[11px] font-normal py-0 mt-0.5">
                          {optionsLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {item.variant.sku}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.branch?.name || "শাখা"}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        <span className={isOut ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                          {item.qty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {item.reorderLevel}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={isOut ? "destructive" : "warning"} className="text-[11px]">
                          {isOut ? strings.inventory.outOfStock : strings.inventory.lowStockThreshold}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
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
                          >
                            সমন্বয়
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

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

        {/* Quick Adjust Dialog */}
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
                  <Label htmlFor="lowStockDeltaInput" className="text-xs font-semibold">
                    {strings.inventory.adjustmentDelta} (যেমন: নতুন স্টক আসলে ৫ লিখুন)
                  </Label>
                  <Input
                    id="lowStockDeltaInput"
                    type="number"
                    placeholder="যেমন: 10"
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
                  <Label htmlFor="lowStockReasonInput" className="text-xs font-semibold">
                    {strings.inventory.adjustmentReason} *
                  </Label>
                  <Input
                    id="lowStockReasonInput"
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
                disabled={adjustMutation.isPending || !adjustDelta || !adjustReason.trim()}
                onClick={() => adjustMutation.mutate()}
              >
                {adjustMutation.isPending ? "সংরক্ষণ হচ্ছে..." : strings.inventory.confirmAdjustment}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
