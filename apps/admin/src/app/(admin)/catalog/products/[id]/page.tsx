"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { SizeColorGrid, type GridCellData } from "@/components/common/size-color-grid";
import { formatMoney } from "@/lib/utils";
import {
  ArrowLeft,
  Barcode,
  Edit2,
  Plus,
  AlertCircle,
  CheckCircle2,
  DollarSign,
} from "lucide-react";
import Link from "next/link";

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;
  const { strings, locale } = useTranslation();
  const { apiFetch, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [barcodeVariantId, setBarcodeVariantId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");
  const [editingVariant, setEditingVariant] = useState<any | null>(null);
  const [editPrice, setEditPrice] = useState<string>("");
  const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
  const [bulkPriceValue, setBulkPriceValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const canSeeCost = hasPermission("report.profit") || hasPermission("purchase.read");

  // Fetch product data
  const { data: product, isLoading, error } = useQuery({
    queryKey: ["product", productId],
    queryFn: async () => {
      const res = await apiFetch(`/products/${productId}`);
      if (!res.ok) throw new Error("Failed to load product");
      const json = await res.json();
      return json.data;
    },
    enabled: !!productId,
  });

  const variants = product?.variants || [];

  // Extract sizes and colours from variants for the SizeColorGrid
  const sizeSet = new Set<string>();
  const colorSet = new Set<string>();
  const stockMatrix: Record<string, GridCellData> = {};

  variants.forEach((v: any) => {
    let size = "Default";
    let color = "Default";

    if (v.variantOptionValues && v.variantOptionValues.length > 0) {
      v.variantOptionValues.forEach((vov: any) => {
        const optName = vov.optionValue?.option?.name?.toLowerCase();
        if (optName === "size") size = vov.optionValue?.value;
        if (optName === "colour" || optName === "color") color = vov.optionValue?.value;
      });
    }

    sizeSet.add(size);
    colorSet.add(color);

    const totalStock = v.stockLevels
      ? v.stockLevels.reduce((sum: number, sl: any) => sum + (sl.quantity || 0), 0)
      : (v.totalStock ?? 0);

    stockMatrix[`${color}:${size}`] = {
      value: totalStock,
      sku: v.sku,
      lowStock: totalStock > 0 && totalStock <= (v.reorderLevel || 5),
      outOfStock: totalStock <= 0,
    };
  });

  const gridSizes = Array.from(sizeSet);
  const gridColors = Array.from(colorSet);

  // Add Barcode Mutation
  const addBarcodeMutation = useMutation({
    mutationFn: async ({ variantId, barcode }: { variantId: string; barcode: string }) => {
      const res = await apiFetch(`/variants/${variantId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ barcode }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to add barcode");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setBarcodeVariantId(null);
      setNewBarcode("");
      setActionSuccess("বারকোড সফলভাবে যোগ করা হয়েছে (Barcode added)");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Delete Barcode Mutation
  const deleteBarcodeMutation = useMutation({
    mutationFn: async ({ variantId, barcode }: { variantId: string; barcode: string }) => {
      const res = await apiFetch(`/variants/${variantId}/barcodes/${encodeURIComponent(barcode)}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to remove barcode");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setActionSuccess("বারকোড মুছে ফেলা হয়েছে (Barcode removed)");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Update Variant Price Mutation
  const updateVariantMutation = useMutation({
    mutationFn: async ({ variantId, priceMinor }: { variantId: string; priceMinor: number }) => {
      const res = await apiFetch(`/variants/${variantId}`, {
        method: "PATCH",
        body: JSON.stringify({ priceMinor }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to update variant");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setEditingVariant(null);
      setActionSuccess("ভ্যারিয়েন্টের মূল্য হালনাগাদ করা হয়েছে (Price updated)");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Bulk Price Update Mutation
  const bulkPriceMutation = useMutation({
    mutationFn: async (newPriceMinor: number) => {
      const payload = {
        variants: variants.map((v: any) => ({
          variantId: v.id,
          priceMinor: newPriceMinor,
        })),
      };
      const res = await apiFetch(`/products/${productId}/bulk-prices`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to bulk update prices");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setIsBulkPriceOpen(false);
      setBulkPriceValue("");
      setActionSuccess("সকল ভ্যারিয়েন্টের মূল্য একসাথে পরিবর্তন করা হয়েছে (Bulk prices updated)");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  if (isLoading) {
    return (
      <PermissionGate permission="catalog.read">
        <div className="p-8 text-center text-sm text-muted-foreground">
          {strings.common.loading}
        </div>
      </PermissionGate>
    );
  }

  if (error || !product) {
    return (
      <PermissionGate permission="catalog.read">
        <div className="p-8 text-center text-sm text-destructive">
          {locale === "bn" ? "পণ্যটি খুঁজে পাওয়া যায়নি।" : "Product not found."}
        </div>
      </PermissionGate>
    );
  }

  return (
    <PermissionGate permission="catalog.read">
      <div className="space-y-6 max-w-6xl">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/catalog/products">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
                <Badge variant={product.isActive ? "success" : "outline"} className="text-xs">
                  {product.isActive ? strings.common.active : strings.common.inactive}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {product.category?.name || (locale === "bn" ? "ক্যাটাগরি নেই" : "No category")} • {product.brand?.name || (locale === "bn" ? "ব্র্যান্ড নেই" : "No brand")} • {variants.length} {locale === "bn" ? "টি ভ্যারিয়েন্ট" : "variants"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsBulkPriceOpen(true)}
              className="flex items-center gap-1.5"
            >
              <DollarSign className="h-4 w-4" />
              <span>{locale === "bn" ? "একসাথে মূল্য পরিবর্তন" : "Bulk Price Update"}</span>
            </Button>
          </div>
        </div>

        {/* Feedback alerts */}
        {actionError && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="ml-auto text-xs font-bold">✕</button>
          </div>
        )}

        {actionSuccess && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Size-and-Colour Stock Matrix */}
        {gridSizes.length > 0 && gridColors.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center justify-between">
                <span>{locale === "bn" ? "সাইজ ও কালার ভিত্তিক বর্তমান স্টক" : "Size & Colour Stock Matrix"}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {locale === "bn" ? "সবুজ: পর্যাপ্ত স্টক | হলুদ: কম স্টক | লাল: শূন্য" : "Green: In stock | Amber: Low stock | Red: Out of stock"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SizeColorGrid
                sizes={gridSizes}
                colors={gridColors}
                matrix={stockMatrix}
                readOnly
                mode="stock"
              />
            </CardContent>
          </Card>
        )}

        {/* Variants Detailed Table */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">
              {strings.products.variants} ({variants.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="variants-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">{strings.products.sku}</TableHead>
                  <TableHead>{locale === "bn" ? "অপশন" : "Options"}</TableHead>
                  <TableHead className="text-right">{strings.products.price}</TableHead>
                  {canSeeCost && <TableHead className="text-right">{strings.products.costPrice}</TableHead>}
                  <TableHead className="w-[240px]">{strings.products.barcode}</TableHead>
                  <TableHead className="text-right">{strings.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v: any) => {
                  const optionsLabel = v.variantOptionValues && v.variantOptionValues.length > 0
                    ? v.variantOptionValues.map((vov: any) => `${vov.optionValue?.option?.name}: ${vov.optionValue?.value}`).join(", ")
                    : "Standard";

                  return (
                    <TableRow key={v.id} data-testid="variant-row">
                      <TableCell className="font-mono text-xs font-semibold">
                        {v.sku}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary" className="font-normal text-xs">
                          {optionsLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold text-sm">
                        {formatMoney(v.priceMinor)}
                      </TableCell>
                      {canSeeCost && (
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatMoney(v.costMinor)}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {v.barcodes && v.barcodes.length > 0 ? (
                            v.barcodes.map((b: any) => (
                              <span
                                key={b.barcode || b}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono border"
                              >
                                {b.barcode || b}
                                <button
                                  type="button"
                                  onClick={() => deleteBarcodeMutation.mutate({ variantId: v.id, barcode: b.barcode || b })}
                                  className="text-muted-foreground hover:text-destructive"
                                  title="Remove Barcode"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{locale === "bn" ? "বারকোড নেই" : "No barcode"}</span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-primary"
                            onClick={() => {
                              setBarcodeVariantId(v.id);
                              setNewBarcode("");
                              setActionError(null);
                            }}
                            title="Add Barcode"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 gap-1"
                          onClick={() => {
                            setEditingVariant(v);
                            setEditPrice((Number(v.priceMinor) / 100).toString());
                            setActionError(null);
                          }}
                        >
                          <Edit2 className="h-3 w-3" />
                          <span>{locale === "bn" ? "মূল্য পরিবর্তন" : "Edit Price"}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Add Barcode Modal Dialog */}
        {barcodeVariantId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-sm shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Barcode className="h-4 w-4" />
                  {locale === "bn" ? "নতুন বারকোড যোগ করুন" : "Add New Barcode"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="barcodeInput">
                    {locale === "bn" ? "বারকোড নম্বর (টাইপ বা স্ক্যান করুন)" : "Barcode number (type or scan)"}
                  </Label>
                  <Input
                    id="barcodeInput"
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder="e.g. 890123456789"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setBarcodeVariantId(null)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!newBarcode.trim() || addBarcodeMutation.isPending}
                    onClick={() => addBarcodeMutation.mutate({ variantId: barcodeVariantId, barcode: newBarcode.trim() })}
                  >
                    {locale === "bn" ? "যোগ করুন" : "Add"}<span className="sr-only"> (Add)</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Edit Variant Price Modal Dialog */}
        {editingVariant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-sm shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">
                  {locale === "bn" ? `ভ্যারিয়েন্ট মূল্য পরিবর্তন (${editingVariant.sku})` : `Edit Variant Price (${editingVariant.sku})`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editPriceInput">{locale === "bn" ? "বিক্রয় মূল্য (৳)" : "Selling Price (৳)"}</Label>
                  <Input
                    id="editPriceInput"
                    type="number"
                    min={0}
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingVariant(null)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!editPrice || updateVariantMutation.isPending}
                    onClick={() => {
                      const num = Number(editPrice);
                      if (!isNaN(num) && num >= 0) {
                        updateVariantMutation.mutate({
                          variantId: editingVariant.id,
                          priceMinor: Math.round(num * 100),
                        });
                      }
                    }}
                  >
                    {strings.common.save}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Bulk Price Update Modal Dialog */}
        {isBulkPriceOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  {locale === "bn" ? "একসাথে সকল ভ্যারিয়েন্টের মূল্য পরিবর্তন" : "Bulk Price Update for All Variants"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {locale === "bn"
                    ? `এই পণ্যের সকল ${variants.length} টি ভ্যারিয়েন্টের বিক্রয় মূল্য একসাথে পরিবর্তন করা হবে।`
                    : `Selling price will be updated for all ${variants.length} variants of this product.`}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="bulkPriceInput">{locale === "bn" ? "নতুন সাধারণ বিক্রয় মূল্য (৳)" : "New Selling Price (৳)"}</Label>
                  <Input
                    id="bulkPriceInput"
                    type="number"
                    min={0}
                    step="0.01"
                    value={bulkPriceValue}
                    onChange={(e) => setBulkPriceValue(e.target.value)}
                    placeholder="e.g. 1950"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setIsBulkPriceOpen(false)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!bulkPriceValue || bulkPriceMutation.isPending}
                    onClick={() => {
                      const num = Number(bulkPriceValue);
                      if (!isNaN(num) && num >= 0) {
                        bulkPriceMutation.mutate(Math.round(num * 100));
                      }
                    }}
                  >
                    {strings.common.save}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
