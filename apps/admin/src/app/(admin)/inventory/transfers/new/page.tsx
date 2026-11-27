"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Truck, Save, AlertCircle, Trash2, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SizeColorGrid, type GridCellData } from "@/components/common/size-color-grid";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface TransferItemDraft {
  variantId: string;
  productName: string;
  sku: string;
  optionsLabel: string;
  sourceStock: number;
  quantity: number;
  baseUnit?: string;
}

export default function NewStockTransferPage() {
  const router = useRouter();
  const { currentBranch, apiFetch } = useAuth();
  const { locale } = useTranslation();

  const [sourceBranchId, setSourceBranchId] = useState<string>("");
  const [destinationBranchId, setDestinationBranchId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [matrix, setMatrix] = useState<Record<string, GridCellData>>({});
  const [transferItems, setTransferItems] = useState<TransferItemDraft[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // Set default source & destination branches
  React.useEffect(() => {
    if (branches.length > 0) {
      const srcId = currentBranch?.id || branches[0]?.id;
      if (!sourceBranchId) setSourceBranchId(srcId);
      if (!destinationBranchId) {
        const dest = branches.find((b: any) => b.id !== srcId) || branches[1] || branches[0];
        setDestinationBranchId(dest.id);
      }
    }
  }, [branches, currentBranch, sourceBranchId, destinationBranchId]);

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ["products-list-for-transfer"],
    queryFn: async () => {
      const res = await apiFetch("/products?limit=100");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || json.data || [];
    },
  });
  const products = productsData || [];

  // Fetch selected product detail
  const { data: productDetail, isLoading: loadingProduct } = useQuery({
    queryKey: ["product-detail", selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return null;
      const res = await apiFetch(`/products/${selectedProductId}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data;
    },
    enabled: !!selectedProductId,
  });

  // Fetch source branch stock levels for the selected product's variants
  const { data: sourceStockMap = {} } = useQuery({
    queryKey: ["source-stock-levels", sourceBranchId, selectedProductId],
    queryFn: async () => {
      if (!sourceBranchId) return {};
      const res = await apiFetch(`/inventory/levels?branchId=${sourceBranchId}&limit=100`);
      if (!res.ok) return {};
      const json = await res.json();
      const levels = Array.isArray(json.data) ? json.data : (json.data?.items || []);
      const map: Record<string, number> = {};
      for (const l of levels) {
        map[l.variantId] = Number(l.qty || 0);
      }
      return map;
    },
    enabled: !!sourceBranchId,
  });

  // Build grid matrix
  const { sizes, colors, variantLookup } = useMemo(() => {
    if (!productDetail || !productDetail.variants || productDetail.variants.length === 0) {
      return { sizes: [], colors: [], variantLookup: new Map<string, any>() };
    }

    const sizesSet = new Set<string>();
    const colorsSet = new Set<string>();
    const lookup = new Map<string, any>();

    for (const v of productDetail.variants) {
      let variantColor = "Standard";
      let variantSize = "Standard";

      const rawOpts = v.optionValues || [];
      if (rawOpts.length > 0) {
        for (const vov of rawOpts) {
          const optName = (vov.optionValue?.option?.name || "").toLowerCase();
          const val = vov.optionValue?.value || "";
          if (optName.includes("size") || optName.includes("সাইজ")) {
            variantSize = val;
          } else if (optName.includes("color") || optName.includes("colour") || optName.includes("রং")) {
            variantColor = val;
          } else {
            variantSize = val;
          }
        }
      }

      sizesSet.add(variantSize);
      colorsSet.add(variantColor);
      lookup.set(`${variantColor}:${variantSize}`, v);
    }

    return {
      sizes: Array.from(sizesSet),
      colors: Array.from(colorsSet),
      variantLookup: lookup,
    };
  }, [productDetail]);

  // Update matrix cells when productDetail or sourceStockMap changes
  React.useEffect(() => {
    if (sizes.length > 0 && colors.length > 0) {
      const initial: Record<string, GridCellData> = {};
      for (const c of colors) {
        for (const s of sizes) {
          const key = `${c}:${s}`;
          const variant = variantLookup.get(key);
          const stock = variant ? (sourceStockMap[variant.id] ?? 0) : 0;
          initial[key] = {
            value: 0,
            sku: variant ? `${variant.sku} (মজুদ: ${stock})` : undefined,
            disabled: !variant,
            outOfStock: stock <= 0,
          };
        }
      }
      setMatrix(initial);
    } else {
      setMatrix({});
    }
  }, [sizes, colors, variantLookup, sourceStockMap]);

  const handleCellChange = (color: string, size: string, value: number) => {
    const key = `${color}:${size}`;
    setMatrix((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        value: Math.max(0, value),
      },
    }));
  };

  // Add items from grid to transfer list
  const handleAddFromGrid = () => {
    if (!productDetail) return;
    const newItems: TransferItemDraft[] = [];

    for (const [key, cell] of Object.entries(matrix)) {
      if (cell.value > 0) {
        const variant = variantLookup.get(key);
        if (variant) {
          const [c, s] = key.split(":");
          const sourceStock = sourceStockMap[variant.id] ?? 0;
          newItems.push({
            variantId: variant.id,
            productName: productDetail.name,
            sku: variant.sku,
            optionsLabel: `${c} / ${s}`,
            sourceStock,
            quantity: cell.value,
            baseUnit: productDetail.baseUnit || "pcs",
          });
        }
      }
    }

    if (newItems.length === 0) {
      setErrorMessage(locale === "bn" ? "অন্তত একটি ভ্যারিয়েন্টের ট্রান্সফার পরিমাণ দিন" : "Enter transfer quantity for at least one variant");
      return;
    }

    // Merge or append to transferItems
    setTransferItems((prev) => {
      const updated = [...prev];
      for (const item of newItems) {
        const existingIdx = updated.findIndex((i) => i.variantId === item.variantId);
        if (existingIdx >= 0) {
          updated[existingIdx].quantity = item.quantity;
        } else {
          updated.push(item);
        }
      }
      return updated;
    });

    // Reset grid inputs to 0
    setMatrix((prev) => {
      const reset = { ...prev };
      for (const k in reset) {
        reset[k] = { ...reset[k], value: 0 };
      }
      return reset;
    });
    setErrorMessage(null);
  };

  const handleRemoveItem = (variantId: string) => {
    setTransferItems((prev) => prev.filter((i) => i.variantId !== variantId));
  };

  const handleQuantityChange = (variantId: string, qty: number) => {
    setTransferItems((prev) =>
      prev.map((item) =>
        item.variantId === variantId ? { ...item, quantity: Math.max(1, qty) } : item
      )
    );
  };

  // Mutation to create transfer
  const createMutation = useMutation({
    mutationFn: async (sendImmediately: boolean) => {
      setErrorMessage(null);

      if (sourceBranchId === destinationBranchId) {
        throw new Error(
          locale === "bn"
            ? "উৎস ও গন্তব্য শাখা একই হতে পারে না"
            : "Source and destination branch cannot be the same"
        );
      }

      if (transferItems.length === 0) {
        throw new Error(
          locale === "bn"
            ? "ট্রান্সফার তালিকায় অন্তত একটি পণ্য যোগ করুন"
            : "Please add at least one item to the transfer"
        );
      }

      // 1. Create transfer in draft status
      const createRes = await apiFetch("/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceBranchId,
          destinationBranchId,
          notes: notes.trim() || undefined,
          items: transferItems.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json();
        throw new Error(errJson.error?.message || "Failed to create transfer");
      }

      const created = await createRes.json();
      const transferId = created.data?.id;

      // 2. If requested, send immediately
      if (sendImmediately && transferId) {
        const sendRes = await apiFetch(`/inventory/transfers/${transferId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "Dispatched upon creation" }),
        });
        if (!sendRes.ok) {
          const sendErr = await sendRes.json();
          throw new Error(sendErr.error?.message || "Transfer created as draft, but dispatch failed");
        }
      }

      return transferId;
    },
    onSuccess: (transferId) => {
      if (transferId) {
        router.push(`/inventory/transfers/${transferId}`);
      } else {
        router.push("/inventory/transfers");
      }
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "An error occurred");
    },
  });

  const totalTransferQty = transferItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Back button and Header */}
      <div className="flex items-center gap-3">
        <Link href="/inventory/transfers">
          <Button variant="outline" size="sm" className="h-8 px-2.5">
            <ArrowLeft className="w-4 h-4 mr-1" />
            {locale === "bn" ? "তালিকায় ফিরুন" : "Back to Transfers"}
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {locale === "bn" ? "নতুন স্টক ট্রান্সফার তৈরি" : "New Stock Transfer"}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {locale === "bn"
              ? "এক শাখা থেকে অন্য শাখায় পণ্য পাঠানোর খসড়া তৈরি করুন অথবা সরাসরি পাঠিয়ে দিন"
              : "Create a draft dispatch or send inventory directly to another branch"}
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Branches & Notes Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 rounded-lg border border-border bg-card shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            {locale === "bn" ? "উৎস শাখা (যেখান থেকে পাঠানো হচ্ছে)" : "Source Branch"}
          </label>
          <select
            value={sourceBranchId}
            onChange={(e) => setSourceBranchId(e.target.value)}
            data-testid="source-branch-select"
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            {locale === "bn" ? "গন্তব্য শাখা (যেখানে গ্রহণ করা হবে)" : "Destination Branch"}
          </label>
          <select
            value={destinationBranchId}
            onChange={(e) => setDestinationBranchId(e.target.value)}
            data-testid="destination-branch-select"
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            {branches.map((b: any) => (
              <option key={b.id} value={b.id} disabled={b.id === sourceBranchId}>
                {b.name} ({b.code}) {b.id === sourceBranchId ? (locale === "bn" ? "(উৎস শাখা)" : "(Source)") : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            {locale === "bn" ? "ট্রান্সফার নোট বা চালান বিবরণ (ঐচ্ছিক)" : "Transfer Notes / Delivery Instructions (Optional)"}
          </label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={locale === "bn" ? "যেমন: কুরিয়ার বা ভ্যান নম্বর, বিশেষ নির্দেশিকা..." : "e.g. Courier tracking #, vehicle info..."}
            className="h-9 text-xs"
            data-testid="transfer-notes-input"
          />
        </div>
      </div>

      {/* Product Selection and Variant Grid Card */}
      <div className="p-5 rounded-lg border border-border bg-card shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            {locale === "bn" ? "পণ্য নির্বাচন করুন" : "Select Product"}
          </label>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            data-testid="transfer-product-select"
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            <option value="">{locale === "bn" ? "-- পণ্য নির্বাচন করুন --" : "-- Select a product --"}</option>
            {products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.category?.name ? `(${p.category.name})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Size Color Grid for Selected Product */}
        {loadingProduct ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {locale === "bn" ? "ভ্যারিয়েন্ট গ্রিড লোড হচ্ছে..." : "Loading variant grid..."}
          </div>
        ) : selectedProductId && productDetail ? (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                {locale === "bn" ? "সাইজ ও রঙ অনুযায়ী পাঠানোর পরিমাণ:" : "Dispatch Quantity by Size & Color:"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {locale === "bn"
                  ? "* প্রতিটি সেলে বর্তমান উৎস শাখার মজুদ দেখানো হয়েছে"
                  : "* Source branch available stock shown in each cell"}
              </span>
            </div>

            <SizeColorGrid
              sizes={sizes}
              colors={colors}
              matrix={matrix}
              onChange={handleCellChange}
              mode="stock"
            />

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                size="sm"
                onClick={handleAddFromGrid}
                data-testid="add-grid-to-transfer-btn"
                className="gap-1.5 text-xs h-8"
              >
                <Plus className="w-3.5 h-3.5" />
                {locale === "bn" ? "তালিকায় যুক্ত করুন" : "Add to Transfer List"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Transfer Items Table */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {locale === "bn" ? "পাঠানোর জন্য প্রস্তুত পণ্যসমূহ" : "Transfer Items Ready for Dispatch"}
          </h2>
          <Badge variant="outline" className="text-xs font-mono">
            {transferItems.length} {locale === "bn" ? "টি আইটেম" : "items"} | {locale === "bn" ? "মোট:" : "Total:"} {totalTransferQty}
          </Badge>
        </div>

        <Table data-testid="transfer-draft-items-table">
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "bn" ? "পণ্য" : "Product"}</TableHead>
              <TableHead className="w-[140px]">{locale === "bn" ? "এসকেইউ" : "SKU"}</TableHead>
              <TableHead className="w-[140px]">{locale === "bn" ? "সাইজ / রঙ" : "Variant"}</TableHead>
              <TableHead className="w-[120px] text-right">{locale === "bn" ? "উৎস মজুদ" : "Source Stock"}</TableHead>
              <TableHead className="w-[140px] text-right">{locale === "bn" ? "পাঠানোর পরিমাণ" : "Transfer Qty"}</TableHead>
              <TableHead className="w-[80px] text-right">{locale === "bn" ? "মুছুন" : "Remove"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transferItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-xs">
                  {locale === "bn"
                    ? "উপরে পণ্য নির্বাচন করে তালিকায় যোগ করুন"
                    : "No items added yet. Select a product above and click 'Add to Transfer List'."}
                </TableCell>
              </TableRow>
            ) : (
              transferItems.map((item) => (
                <TableRow key={item.variantId} className="h-[52px]">
                  <TableCell className="font-medium text-xs text-foreground">
                    {item.productName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.sku}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[11px] font-normal py-0">
                      {item.optionsLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {item.sourceStock} {item.baseUnit || "pcs"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => handleQuantityChange(item.variantId, Number(e.target.value))}
                        className="w-16 h-7 text-xs text-right font-mono tabular-nums"
                        data-testid={`qty-input-${item.variantId}`}
                      />
                      <span className="text-[11px] text-muted-foreground font-mono">{item.baseUnit || "pcs"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveItem(item.variantId)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Link href="/inventory/transfers">
          <Button variant="outline" size="sm" className="h-9 text-xs">
            {locale === "bn" ? "বাতিল" : "Cancel"}
          </Button>
        </Link>

        <Button
          type="button"
          variant="secondary"
          disabled={transferItems.length === 0 || createMutation.isPending}
          onClick={() => createMutation.mutate(false)}
          data-testid="save-draft-transfer-btn"
          className="gap-2 h-9 text-xs"
        >
          <Save className="w-3.5 h-3.5" />
          {locale === "bn" ? "খসড়া সংরক্ষণ" : "Save Draft"}
        </Button>

        <Button
          type="button"
          disabled={transferItems.length === 0 || createMutation.isPending}
          onClick={() => createMutation.mutate(true)}
          data-testid="send-now-transfer-btn"
          className="gap-2 h-9 text-xs"
        >
          <Truck className="w-3.5 h-3.5" />
          {locale === "bn" ? "পাঠিয়ে দিন" : "Send Transfer"}
        </Button>
      </div>
    </div>
  );
}
