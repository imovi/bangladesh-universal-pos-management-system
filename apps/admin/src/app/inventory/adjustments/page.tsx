"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
  SlidersHorizontal,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Search,
} from "lucide-react";
import Link from "next/link";

export default function StockAdjustmentsPage() {
  const { strings } = useTranslation();
  const { apiFetch } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [variantSearch, setVariantSearch] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);

  // Adjustment mode: "counted" (actual count) or "delta" (plus/minus)
  const [mode, setMode] = useState<"delta" | "counted">("counted");
  const [countedQty, setCountedQty] = useState("");
  const [deltaQty, setDeltaQty] = useState("");
  const [reason, setReason] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

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

  // Auto-select branch
  React.useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  // Search variants in current branch
  const { data: searchResults = [], isLoading: searchingVariants } = useQuery({
    queryKey: ["search-variants-for-adjustment", selectedBranchId, variantSearch],
    enabled: variantSearch.trim().length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      params.set("search", variantSearch.trim());
      params.set("limit", "10");

      const res = await apiFetch(`/inventory/levels?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || [];
    },
  });

  // Fetch recent adjustment movements
  const { data: recentMovements = [], isLoading: loadingMovements } = useQuery({
    queryKey: ["recent-adjustments", selectedBranchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      params.set("type", "ADJUSTMENT");
      params.set("limit", "15");

      const res = await apiFetch(`/inventory/movements?${params.toString()}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || [];
    },
  });

  // Calculate before, delta, and after
  const currentQty = selectedVariant ? selectedVariant.qty : 0;
  let computedDelta = 0;
  let computedAfter = currentQty;

  if (mode === "counted") {
    const counted = parseInt(countedQty, 10);
    if (!isNaN(counted)) {
      computedDelta = counted - currentQty;
      computedAfter = counted;
    }
  } else {
    const delta = parseInt(deltaQty, 10);
    if (!isNaN(delta)) {
      computedDelta = delta;
      computedAfter = currentQty + delta;
    }
  }

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error("শাখা নির্বাচন করুন (Select a branch)");
      if (!selectedVariant) throw new Error("ভ্যারিয়েন্ট নির্বাচন করুন (Select a variant)");
      if (computedDelta === 0) {
        throw new Error("মজুদের কোন পরিবর্তন হয়নি (Quantity change cannot be 0)");
      }
      if (!reason.trim() || reason.trim().length < 3) {
        throw new Error("সমন্বয়ের কারণ অন্তত ৩ অক্ষরের হতে হবে (Reason must be at least 3 chars)");
      }

      const res = await apiFetch("/inventory/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          variantId: selectedVariant.variantId,
          qtyDelta: computedDelta,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Adjustment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
      queryClient.invalidateQueries({ queryKey: ["recent-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["search-variants-for-adjustment"] });
      setFormSuccess(
        `সফলভাবে মজুদ সমন্বয় করা হয়েছে! (${selectedVariant?.variant?.product?.name}: ${currentQty} → ${computedAfter})`
      );
      setFormError(null);
      // Update selected variant qty locally
      setSelectedVariant((prev: any) => (prev ? { ...prev, qty: computedAfter } : null));
      setCountedQty("");
      setDeltaQty("");
      setReason("");
    },
    onError: (err: any) => {
      setFormError(err.message || "Failed to adjust stock");
    },
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Link href="/inventory/stock">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {strings.inventory.adjustStock}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              গণনা সংশোধন বা ঘাটতি/বাড়তির কারণে মজুদের হিসাব সমন্বয় করুন
            </p>
          </div>
        </div>

        {formError && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
            <button onClick={() => setFormError(null)} className="ml-auto text-xs font-bold">✕</button>
          </div>
        )}

        {formSuccess && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{formSuccess}</span>
            <button onClick={() => setFormSuccess(null)} className="ml-auto text-xs font-bold">✕</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Step 1 & 2: Adjustment Form */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span>সমন্বয় ফরম</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Branch */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">{strings.inventory.selectBranch} *</Label>
                <select
                  data-testid="adjust-branch-select"
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value);
                    setSelectedVariant(null);
                  }}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Variant Search */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">ভ্যারিয়েন্ট খুঁজুন (নাম, SKU বা বারকোড) *</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-testid="adjust-variant-search"
                    placeholder="কমপক্ষে ২ অক্ষর লিখুন..."
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>

                {/* Search Results Dropdown */}
                {variantSearch.trim().length >= 2 && (
                  <div className="rounded-md border bg-card p-1 shadow-sm max-h-48 overflow-y-auto space-y-1">
                    {searchingVariants ? (
                      <div className="p-2 text-center text-xs text-muted-foreground">খোঁজা হচ্ছে...</div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-2 text-center text-xs text-muted-foreground">কোন ভ্যারিয়েন্ট মেলেনি</div>
                    ) : (
                      searchResults.map((item: any) => {
                        const opt = item.variant.variantOptionValues?.map((vov: any) => `${vov.optionValue?.value}`).join(", ") || "";
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedVariant(item);
                              setVariantSearch("");
                            }}
                            className="w-full text-left p-2 rounded hover:bg-muted text-xs flex items-center justify-between"
                            data-testid="select-variant-option"
                          >
                            <div>
                              <div className="font-semibold text-foreground">{item.variant.product.name}</div>
                              <div className="text-muted-foreground font-mono">{item.variant.sku} {opt && `(${opt})`}</div>
                            </div>
                            <Badge variant="outline" className="font-mono">
                              মজুদ: {item.qty}
                            </Badge>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Selected Variant Display */}
              {selectedVariant && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-2 border">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{selectedVariant.variant.product.name}</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      বর্তমান স্টক: {selectedVariant.qty}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    SKU: {selectedVariant.variant.sku} • শাখা: {selectedVariant.branch?.name}
                  </div>
                </div>
              )}

              {/* Mode Selection */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">{strings.inventory.adjustmentType}</Label>
                <div className="flex rounded-md border p-1 bg-muted/20 gap-1">
                  <button
                    type="button"
                    onClick={() => setMode("counted")}
                    className={`flex-1 text-xs py-1.5 rounded-sm font-medium transition-colors ${
                      mode === "counted" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    গণনাকৃত নতুন মজুদ (Counted Total)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("delta")}
                    className={`flex-1 text-xs py-1.5 rounded-sm font-medium transition-colors ${
                      mode === "delta" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    পার্থক্য (+/- Delta)
                  </button>
                </div>
              </div>

              {/* Quantity Input */}
              {mode === "counted" ? (
                <div className="space-y-2">
                  <Label htmlFor="countedInput" className="text-xs font-semibold">
                    {strings.inventory.newQuantity} *
                  </Label>
                  <Input
                    id="countedInput"
                    data-testid="adjust-counted-input"
                    type="number"
                    placeholder="যেমন: 25"
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="deltaInput" className="text-xs font-semibold">
                    {strings.inventory.adjustmentDelta} (+/-) *
                  </Label>
                  <Input
                    id="deltaInput"
                    data-testid="adjust-delta-input"
                    type="number"
                    placeholder="যেমন: +5 অথবা -3"
                    value={deltaQty}
                    onChange={(e) => setDeltaQty(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              )}

              {/* Reason */}
              <div className="space-y-2">
                <Label htmlFor="adjustReason" className="text-xs font-semibold">
                  {strings.inventory.adjustmentReason} (বাধ্যতামূলক) *
                </Label>
                <Input
                  id="adjustReason"
                  data-testid="adjust-reason-field"
                  placeholder="যেমন: নষ্ট পণ্য, গণনা সংশোধন, ইত্যাদি..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              {/* Submit */}
              <Button
                data-testid="btn-submit-adjustment"
                className="w-full"
                disabled={
                  adjustMutation.isPending ||
                  !selectedVariant ||
                  computedDelta === 0 ||
                  !reason.trim() ||
                  reason.trim().length < 3
                }
                onClick={() => adjustMutation.mutate()}
              >
                {adjustMutation.isPending ? "সংরক্ষণ হচ্ছে..." : strings.inventory.confirmAdjustment}
              </Button>
            </CardContent>
          </Card>

          {/* Before & After Preview Card */}
          <div className="space-y-6">
            <Card className="shadow-sm border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">সমন্বয়ের প্রভাব (Before & After Preview)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedVariant ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/40 border">
                      <div className="text-center flex-1">
                        <div className="text-xs text-muted-foreground">পূর্বের মজুদ (Before)</div>
                        <div className="text-2xl font-bold font-mono mt-1">{currentQty}</div>
                      </div>

                      <div className="flex flex-col items-center px-4">
                        <ArrowRight className="h-5 w-5 text-muted-foreground" />
                        <span className={`text-xs font-bold font-mono mt-1 ${computedDelta > 0 ? "text-emerald-600" : computedDelta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {computedDelta > 0 ? `+${computedDelta}` : computedDelta}
                        </span>
                      </div>

                      <div className="text-center flex-1">
                        <div className="text-xs text-muted-foreground">পরের মজুদ (After)</div>
                        <div className="text-2xl font-bold font-mono mt-1 text-primary">
                          {computedAfter}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded border">
                      <strong>সতর্কতা:</strong> স্টক সমন্বয় নিশ্চিত করলে ইনভেন্টরি লেজারে স্থায়ীভাবে ট্রানজেকশন রেকর্ড হবে।
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    সমন্বয় শুরু করতে প্রথমে বামপাশ থেকে একটি ভ্যারিয়েন্ট নির্বাচন করুন
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Adjustments */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">সাম্প্রতিক সমন্বয়সমূহ (Recent Adjustments)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">তারিখ</TableHead>
                      <TableHead className="text-xs text-right">পরিবর্তন</TableHead>
                      <TableHead className="text-xs">কারণ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingMovements ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-xs py-4 text-muted-foreground">
                          লোড হচ্ছে...
                        </TableCell>
                      </TableRow>
                    ) : recentMovements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-xs py-4 text-muted-foreground">
                          কোন সাম্প্রতিক সমন্বয় নেই
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentMovements.slice(0, 5).map((m: any) => {
                        const isPos = m.qtyDelta > 0;
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(m.occurredAt).toLocaleDateString("bn-BD")}
                            </TableCell>
                            <TableCell className="text-xs text-right font-bold font-mono">
                              <span className={isPos ? "text-emerald-600" : "text-destructive"}>
                                {isPos ? `+${m.qtyDelta}` : m.qtyDelta}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {m.reason || "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
