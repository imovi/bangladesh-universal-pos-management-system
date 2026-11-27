"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n/context";
import { useAuth, useModules } from "@/lib/auth-context";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import { formatDateTime } from "@/lib/utils";
import { formatMovementType } from "@/i18n/formatters";
import { formatStockWithBiggestUnit } from "@universal-pos/shared";
import {
  Search,
  History,
  AlertTriangle,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Barcode,
} from "lucide-react";
import Link from "next/link";
import { BarcodePrintModal } from "@/components/barcodes/barcode-print-modal";

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
  const isBn = locale === "bn";
  const { apiFetch, hasPermission, currentBranch } = useAuth();
  const { hasModule } = useModules();
  const isUnitsActive = hasModule("units");
  const queryClient = useQueryClient();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch?.id || "");
  const [searchTerm, setSearchTerm] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modals state
  const [adjustItem, setAdjustItem] = useState<StockLevelItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [historyItem, setHistoryItem] = useState<StockLevelItem | null>(null);
  const [barcodePrintItem, setBarcodePrintItem] = useState<StockLevelItem | null>(null);
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
    queryKey: ["stock-levels", selectedBranchId, searchTerm, lowStockOnly, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      if (searchTerm) params.set("search", searchTerm);
      if (lowStockOnly) params.set("lowStock", "true");
      params.set("page", String(page));
      params.set("limit", String(pageSize));

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
    queryKey: ["variant-movements", historyItem?.variantId, historyItem?.branchId],
    enabled: !!historyItem,
    queryFn: async () => {
      if (!historyItem) return [];
      const res = await apiFetch(
        `/inventory/movements?variantId=${historyItem.variantId}&branchId=${historyItem.branchId}&limit=20`
      );
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : (json.data?.items || []);
    },
  });

  // Quick adjust mutation
  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!adjustItem) throw new Error("No item selected");
      const delta = parseInt(adjustDelta, 10);
      if (isNaN(delta) || delta === 0) {
        throw new Error(isBn ? "সঠিক পরিমাণ লিখুন" : "Please enter a non-zero adjustment delta");
      }
      if (!adjustReason.trim() || adjustReason.trim().length < 3) {
        throw new Error(isBn ? "সমন্বয়ের কারণ অন্তত ৩ অক্ষরের হতে হবে" : "Reason must be at least 3 characters");
      }

      const res = await apiFetch("/inventory/adjustment", {
        method: "POST",
        body: JSON.stringify({
          branchId: adjustItem.branchId,
          variantId: adjustItem.variantId,
          qtyDelta: delta,
          reason: adjustReason.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Adjustment failed");
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
      setActionSuccess(isBn ? "স্টক সমন্বয় করা হয়েছে" : "Stock adjusted successfully");
      setAdjustItem(null);
      setAdjustDelta("");
      setAdjustReason("");
      setTimeout(() => setActionSuccess(null), 4000);
    },
    onError: (err: any) => {
      setAdjustError(err.message || "Adjustment failed");
    },
  });

  const items = stockData?.items || [];
  const pagination = stockData?.pagination || { total: 0, totalPages: 1 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {strings.inventory.title}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {isBn
              ? "শাখাভিত্তিক ভ্যারিয়েন্ট স্টক নিরীক্ষণ ও দ্রুত সমন্বয়"
              : "Live branch stock levels and adjustments"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("inventory.manage") && (
            <Link href="/inventory/opening">
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs sm:text-sm">
                <PlusCircle className="h-4 w-4" />
                <span>{strings.inventory.openingStockEntry}</span>
              </Button>
            </Link>
          )}
          {hasPermission("stock.adjust") && (
            <Link href="/inventory/adjustments">
              <Button size="sm" className="h-9 gap-1.5 text-xs sm:text-sm">
                <span>{strings.inventory.adjustStock}</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {actionSuccess && (
        <div
          role="alert"
          data-testid="success-alert"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-700 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isBn ? "পণ্য, এসকেইউ বা বারকোড দিয়ে খুঁজুন..." : "Search by product, SKU or barcode..."}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-9 text-xs sm:text-sm"
            data-testid="stock-search-input"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch selector */}
          <div className="w-48">
            <Select
              value={selectedBranchId}
              onValueChange={(val) => {
                setSelectedBranchId(val === "all" ? "" : val);
                setPage(1);
              }}
            >
              <SelectTrigger
                className="h-9 text-xs sm:text-sm"
                data-testid="stock-branch-select"
                aria-label={strings.selectEmpty.allBranches}
              >
                <SelectValue placeholder={strings.selectEmpty.allBranches} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                  {strings.selectEmpty.allBranches}
                </SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs sm:text-sm">
                    {b.code ? `${b.code} - ${b.name}` : b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
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
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <Table data-testid="stock-levels-table">
          <TableHeader>
            <TableRow>
              <TableHead>{isBn ? "পণ্যের বিবরণ ও অপশন" : "Product & Variant"}</TableHead>
              <TableHead className="w-[140px]">{strings.products.sku}</TableHead>
              <TableHead className="w-[160px]">{strings.products.barcode}</TableHead>
              <TableHead className="w-[120px]">{isBn ? "শাখা" : "Branch"}</TableHead>
              <TableHead className="w-[120px] text-right">{strings.inventory.quantity}</TableHead>
              <TableHead className="w-[120px] text-right">{isBn ? "ইন-ট্রানজিট" : "In-Transit"}</TableHead>
              <TableHead className="w-[120px] text-right">{strings.inventory.reorderLevel}</TableHead>
              <TableHead className="w-[160px] text-right">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground text-sm">
                  {strings.common.loading}
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground text-sm">
                  {strings.common.noData}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item: any) => {
                const rawOpts = (item.variant as any)?.optionValues || [];
                const optionsLabel =
                  rawOpts.length > 0
                    ? rawOpts
                        .map((vov: any) => vov.optionValue?.value)
                        .filter(Boolean)
                        .join(" / ")
                    : (isBn ? "সাধারণ" : "Standard");

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
                    className={`h-[56px] transition-colors ${
                      isAtOrBelowReorder ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/40"
                    }`}
                  >
                    <TableCell>
                      <div className="font-semibold text-sm text-foreground">{item.variant.product.name}</div>
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

                    <TableCell className="font-mono text-xs font-semibold text-foreground">
                      {item.variant.sku}
                    </TableCell>

                    <TableCell className="text-xs font-mono">
                      {item.variant.barcodes && item.variant.barcodes.length > 0 ? (
                        item.variant.barcodes.map((b: any) => (
                          <div key={b.id || b.barcode || b} className="text-muted-foreground flex items-center gap-1">
                            <span>{b.barcode || b}</span>
                            {b.productUnit?.name && (
                              <span className="text-[10px] px-1 py-0.2 rounded bg-primary/10 text-primary font-sans">
                                {b.productUnit.name}
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
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
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold font-mono tabular-nums ${
                          isOut
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                            : isLow
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        }`}
                        data-testid="stock-qty-badge"
                      >
                        {isUnitsActive &&
                        (item.variant?.product?.units?.length > 0 ||
                          (item.variant?.product?.baseUnit &&
                            item.variant.product.baseUnit !== "pcs"))
                          ? formatStockWithBiggestUnit(
                              Number(item.qty),
                              item.variant?.product?.baseUnit || "pcs",
                              item.variant?.product?.units,
                              locale as any,
                            )
                          : item.qty}
                      </span>
                    </TableCell>

                    <TableCell className="text-right text-xs font-mono tabular-nums" data-testid="in-transit-qty-cell">
                      {Number(item.inTransitQty || 0) > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-[11px] font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30 font-mono tabular-nums"
                        >
                          +{item.inTransitQty}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right text-xs font-mono tabular-nums">
                      {reorderVal !== null ? (
                        <span className={isAtOrBelowReorder ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-muted-foreground"}>
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
                            {isBn ? "সমন্বয়" : "Adjust"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => setBarcodePrintItem(item)}
                          data-testid="btn-print-row-barcode"
                        >
                          <Barcode className="h-3.5 w-3.5 mr-1" />
                          <span>{isBn ? "বারকোড" : "Barcode"}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => setHistoryItem(item)}
                          data-testid="btn-history-row"
                        >
                          <History className="h-3.5 w-3.5 mr-1" />
                          <span>{isBn ? "ইতিহাস" : "History"}</span>
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
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={pagination.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Quick Stock Adjustment Dialog */}
      <Dialog open={!!adjustItem} onOpenChange={(open) => !open && setAdjustItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {strings.inventory.adjustStock}
            </DialogTitle>
          </DialogHeader>

          {adjustItem && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                <div className="font-semibold text-sm text-foreground">{adjustItem.variant.product.name}</div>
                <div className="text-muted-foreground">
                  {strings.products.sku}: <span className="font-mono font-medium text-foreground">{adjustItem.variant.sku}</span> • {isBn ? "শাখা" : "Branch"}: {adjustItem.branch?.name}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span>{strings.inventory.currentStock}:</span>
                  <Badge variant="secondary" className="font-mono tabular-nums font-semibold">
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
                  {strings.inventory.adjustmentDelta} ({isBn ? "যোগ করতে ধণাত্মক, কমাতে ঋণাত্মক" : "+ to add, - to subtract"})
                </Label>
                <Input
                  id="adjustDeltaInput"
                  data-testid="adjust-delta-input"
                  type="number"
                  placeholder={isBn ? "যেমন: 5 অথবা -2" : "e.g. 5 or -2"}
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  className="h-9 text-sm font-mono tabular-nums"
                />
                {adjustDelta && !isNaN(parseInt(adjustDelta, 10)) && (
                  <p className="text-xs text-muted-foreground">
                    {isBn ? "সমন্বয়ের পর নতুন মজুদ:" : "New stock quantity:"}{" "}
                    <span className="font-semibold text-foreground font-mono tabular-nums">
                      {adjustItem.qty + parseInt(adjustDelta, 10)}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="adjustReasonInput" className="text-xs font-semibold">
                  {strings.inventory.adjustmentReason} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="adjustReasonInput"
                  data-testid="adjust-reason-input"
                  placeholder={isBn ? "সমন্বয়ের কারণ লিখুন..." : "Enter adjustment reason..."}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAdjustItem(null)}>
              {strings.common.cancel}
            </Button>
            <Button
              size="sm"
              data-testid="btn-save-adjustment"
              disabled={adjustMutation.isPending || !adjustDelta || !adjustReason.trim()}
              onClick={() => adjustMutation.mutate()}
            >
              {adjustMutation.isPending ? strings.common.loading : strings.inventory.confirmAdjustment}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement History Dialog */}
      <Dialog open={!!historyItem} onOpenChange={(open) => !open && setHistoryItem(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center justify-between">
              <span>{strings.inventory.movementHistory}</span>
              {historyItem && (
                <span className="text-xs font-mono font-normal text-muted-foreground">
                  {historyItem.variant.sku}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 my-2 border border-border rounded-lg">
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
                      {strings.common.loading}
                    </TableCell>
                  </TableRow>
                ) : !movementsData || movementsData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
                      {strings.common.noData}
                    </TableCell>
                  </TableRow>
                ) : (
                  movementsData.map((m: MovementItem) => {
                    const isPositive = m.qtyDelta > 0;
                    return (
                      <TableRow key={m.id} data-testid="movement-row" className="h-[44px]">
                        <TableCell className="text-xs whitespace-nowrap font-mono tabular-nums">
                          {formatDateTime(m.occurredAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {formatMovementType(m.type, strings)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono tabular-nums font-semibold">
                          <span className={isPositive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                            {isPositive ? `+${m.qtyDelta}` : m.qtyDelta}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.reason || (m.referenceType ? `${m.referenceType}: ${m.referenceId?.slice(0, 8)}...` : "—")}
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
              {strings.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Barcode Print Modal */}
      {barcodePrintItem && (
        <BarcodePrintModal
          isOpen={!!barcodePrintItem}
          onClose={() => setBarcodePrintItem(null)}
          shopName={barcodePrintItem.branch?.name || "Universal POS"}
          items={[
            {
              variantId: barcodePrintItem.variant.id,
              productName: barcodePrintItem.variant.product.name,
              variantName: barcodePrintItem.variant.sku,
              priceMinor: barcodePrintItem.variant.priceMinor || 0,
              barcode: barcodePrintItem.variant.barcodes?.[0]?.barcode,
              quantity: Math.max(1, Number(barcodePrintItem.qty) || 1),
            },
          ]}
          onBarcodesUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
          }}
        />
      )}
    </div>
  );
}
