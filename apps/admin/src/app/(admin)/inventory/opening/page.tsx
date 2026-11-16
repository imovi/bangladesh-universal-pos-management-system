"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SizeColorGrid, type GridCellData } from "@/components/common/size-color-grid";
import {
  Boxes,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Save,
} from "lucide-react";
import Link from "next/link";

export default function OpeningStockPage() {
  const { strings } = useTranslation();
  const { apiFetch } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [unitCostTaka, setUnitCostTaka] = useState("");
  const [matrix, setMatrix] = useState<Record<string, GridCellData>>({});

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

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["catalog-products-all"],
    queryFn: async () => {
      const res = await apiFetch("/products?limit=100");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || json.data || [];
    },
  });

  // Fetch selected product detail to get variants and options
  const { data: productDetail, isLoading: loadingProductDetail } = useQuery({
    queryKey: ["product-detail", selectedProductId],
    enabled: !!selectedProductId,
    queryFn: async () => {
      if (!selectedProductId) return null;
      const res = await apiFetch(`/products/${selectedProductId}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data || null;
    },
  });

  // Auto-select first branch if available
  React.useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  // Extract sizes and colors from selected product
  const { sizes, colors, variantLookup } = useMemo(() => {
    if (!productDetail || !productDetail.variants) {
      return { sizes: [], colors: [], variantLookup: new Map<string, string>() };
    }

    const sizesSet = new Set<string>();
    const colorsSet = new Set<string>();
    const lookup = new Map<string, string>(); // "color:size" -> variantId

    for (const v of productDetail.variants) {
      let variantColor = "Standard";
      let variantSize = "Standard";

      const rawOpts = v.optionValues || v.variantOptionValues || [];
      if (rawOpts.length > 0) {
        for (const vov of rawOpts) {
          const optName = (vov.optionValue?.option?.name || "").toLowerCase();
          const val = vov.optionValue?.value || "";

          if (optName.includes("size") || optName.includes("সাইজ")) {
            variantSize = val;
          } else if (optName.includes("color") || optName.includes("colour") || optName.includes("রং")) {
            variantColor = val;
          } else {
            // fallback if arbitrary option
            variantSize = val;
          }
        }
      }

      sizesSet.add(variantSize);
      colorsSet.add(variantColor);
      lookup.set(`${variantColor}:${variantSize}`, v.id);
    }

    return {
      sizes: Array.from(sizesSet),
      colors: Array.from(colorsSet),
      variantLookup: lookup,
    };
  }, [productDetail]);

  // Reset matrix when product changes
  React.useEffect(() => {
    if (sizes.length > 0 && colors.length > 0) {
      const initial: Record<string, GridCellData> = {};
      for (const c of colors) {
        for (const s of sizes) {
          const key = `${c}:${s}`;
          initial[key] = {
            value: 0,
            disabled: !variantLookup.has(key),
          };
        }
      }
      setMatrix(initial);
    } else {
      setMatrix({});
    }
  }, [sizes, colors, variantLookup]);

  const handleCellChange = (color: string, size: string, value: number) => {
    const key = `${color}:${size}`;
    setMatrix((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        value,
      },
    }));
  };

  const handleToggleCell = (color: string, size: string, enabled: boolean) => {
    const key = `${color}:${size}`;
    setMatrix((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        disabled: !enabled,
      },
    }));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error("শাখা নির্বাচন করুন (Please select a branch)");
      if (!selectedProductId) throw new Error("পণ্য নির্বাচন করুন (Please select a product)");

      const costMinor = unitCostTaka ? Math.round(parseFloat(unitCostTaka) * 100) : undefined;
      if (costMinor !== undefined && (isNaN(costMinor) || costMinor < 0)) {
        throw new Error("সঠিক ক্রয়মূল্য প্রদান করুন (Invalid unit cost)");
      }

      const items: Array<{ variantId: string; quantity: number; unitCostMinor?: number }> = [];

      for (const [key, cell] of Object.entries(matrix)) {
        if (!cell.disabled && cell.value > 0) {
          const variantId = variantLookup.get(key);
          if (variantId) {
            items.push({
              variantId,
              quantity: cell.value,
              unitCostMinor: costMinor,
            });
          }
        }
      }

      if (items.length === 0) {
        throw new Error("অন্তত একটি ভ্যারিয়েন্টে মজুদ প্রদান করতে হবে (Enter quantity > 0 for at least one variant)");
      }

      const res = await apiFetch("/inventory/opening-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          items,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Opening stock submission failed");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
      setFormSuccess("প্রারম্ভিক মজুদ সফলভাবে সংরক্ষণ করা হয়েছে! (Opening stock saved successfully)");
      setFormError(null);
      // Reset matrix quantities
      setMatrix((prev) => {
        const reset: Record<string, GridCellData> = {};
        for (const [k, v] of Object.entries(prev)) {
          reset[k] = { ...v, value: 0 };
        }
        return reset;
      });
    },
    onError: (err: any) => {
      setFormError(err.message || "Failed to save opening stock");
    },
  });

  return (
    <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Link href="/inventory/stock" aria-label={strings.inventory.title || "Back to stock"}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={strings.inventory.title || "Back to stock"}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {strings.inventory.openingStockEntry}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              সাইজ ও রঙের গ্রিডের মাধ্যমে সহজে নতুন পণ্যের প্রাথমিক মজুদ যুক্ত করুন
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
          <div role="alert" data-testid="success-alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{formSuccess}</span>
            <Link href="/inventory/stock" className="ml-auto text-xs underline font-bold">
              মজুদ তালিকায় দেখুন →
            </Link>
          </div>
        )}

        {/* Step 1: Branch & Product Selection */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span>শাখা ও পণ্য নির্বাচন</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="branchSelect" className="text-xs font-semibold">
                  {strings.inventory.selectBranch} *
                </Label>
                <select
                  id="branchSelect"
                  data-testid="opening-branch-select"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="productSelect" className="text-xs font-semibold">
                  {strings.inventory.selectProduct} *
                </Label>
                <select
                  id="productSelect"
                  data-testid="opening-product-select"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">পণ্য বেছে নিন...</option>
                  {products.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitCostInput" className="text-xs font-semibold">
                  {strings.inventory.unitCost} (ঐচ্ছিক, টাকা)
                </Label>
                <Input
                  id="unitCostInput"
                  data-testid="opening-unit-cost-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="যেমন: 500"
                  value={unitCostTaka}
                  onChange={(e) => setUnitCostTaka(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Size & Colour Grid */}
        {selectedProductId && (
          loadingProductDetail ? (
            <Card className="p-8 text-center text-sm text-muted-foreground shadow-sm">
              পণ্যের ভ্যারিয়েন্ট লোড হচ্ছে...
            </Card>
          ) : sizes.length > 0 && colors.length > 0 ? (
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center justify-between">
                  <span>ভ্যারিয়েন্ট ভিত্তিক প্রারম্ভিক স্টক (Initial Stock Quantities)</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    প্রতিটি ঘরে প্রাথমিক মজুদ সংখ্যা লিখুন অথবা "সবগুলোতে বসান" ব্যবহার করুন
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <SizeColorGrid
                  sizes={sizes}
                  colors={colors}
                  matrix={matrix}
                  mode="stock"
                  onChange={handleCellChange}
                  onToggleCell={handleToggleCell}
                />

                <div className="flex items-center justify-end pt-4 border-t">
                  <Button
                    data-testid="btn-save-opening-stock"
                    disabled={submitMutation.isPending}
                    onClick={() => submitMutation.mutate()}
                    className="flex items-center gap-1.5"
                  >
                    <Save className="h-4 w-4" />
                    <span>
                      {submitMutation.isPending
                        ? "সংরক্ষণ হচ্ছে..."
                        : strings.inventory.saveOpeningStock}
                    </span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-muted-foreground shadow-sm">
              এই পণ্যটিতে কোন সাইজ বা রঙের অপশন পাওয়া যায়নি।
            </Card>
          )
        )}
      </div>
  );
}
