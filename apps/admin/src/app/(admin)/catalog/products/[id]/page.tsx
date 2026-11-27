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
  Printer,
} from "lucide-react";
import Link from "next/link";
import { BarcodePrintModal } from "@/components/barcodes/barcode-print-modal";
import { BASE_UNITS, getBaseUnit, computeUnitDerivedPriceMinor } from "@universal-pos/shared";
import { useModules } from "@/lib/auth-context";

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;
  const { strings, locale } = useTranslation();
  const isBn = locale === "bn";
  const { apiFetch, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [barcodeVariantId, setBarcodeVariantId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");
  const [editingVariant, setEditingVariant] = useState<any | null>(null);
  const [editPrice, setEditPrice] = useState<string>("");
  const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
  const [bulkPriceValue, setBulkPriceValue] = useState("");
  const [isBarcodePrintOpen, setIsBarcodePrintOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { isModuleActive } = useModules();
  const isUnitsActive = isModuleActive("units");

  // Unit creation / editing modal
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<any | null>(null);
  const [unitName, setUnitName] = useState("");
  const [unitFactor, setUnitFactor] = useState("");
  const [unitIsSale, setUnitIsSale] = useState(true);
  const [unitIsPurchase, setUnitIsPurchase] = useState(true);
  const [unitIsActive, setUnitIsActive] = useState(true);

  // Variant Unit Price modal
  const [priceOverrideModal, setPriceOverrideModal] = useState<{
    variant: any;
    unit: any;
    currentPriceMinor: number | null;
    derivedPriceMinor: number;
  } | null>(null);
  const [overridePriceTaka, setOverridePriceTaka] = useState("");

  // Barcode unit selection
  const [barcodeUnitId, setBarcodeUnitId] = useState<string>("");

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

    const opts = v.optionValues || [];
    if (opts.length > 0) {
      opts.forEach((vov: any) => {
        const optName = vov.optionValue?.option?.name?.toLowerCase().trim();
        if (optName === "size") size = vov.optionValue?.value;
        if (optName === "colour" || optName === "color") color = vov.optionValue?.value;
      });
    }

    sizeSet.add(size);
    colorSet.add(color);

    const totalStock = v.stockLevels
      ? v.stockLevels.reduce((sum: number, sl: any) => sum + (Number(sl.qty) || 0), 0)
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
    mutationFn: async ({ variantId, barcode, productUnitId }: { variantId: string; barcode: string; productUnitId?: string }) => {
      const res = await apiFetch(`/variants/${variantId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ barcode, productUnitId: productUnitId || undefined }),
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
      setBarcodeUnitId("");
      setActionSuccess("বারকোড সফলভাবে যোগ করা হয়েছে (Barcode added)");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Update Product Settings (Base Unit & Decimal Qty)
  const updateProductSettingsMutation = useMutation({
    mutationFn: async (payload: { baseUnit?: string; allowDecimalQty?: boolean }) => {
      const res = await apiFetch(`/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        if (res.status === 409 || body.error?.code === "BASE_UNIT_CHANGE_NOT_ALLOWED") {
          throw new Error("পণ্যটির স্টক মুভমেন্ট বা বিক্রয় বিদ্যমান থাকায় বেস ইউনিট পরিবর্তন করা সম্ভব নয়।");
        }
        throw new Error(body.error?.message || "Failed to update product");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setActionSuccess("পণ্যের সেটিংস সফলভাবে সংরক্ষিত হয়েছে");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Save Unit (Create or Update)
  const saveUnitMutation = useMutation({
    mutationFn: async (payload: { id?: string; name: string; factor: number; isSaleUnit: boolean; isPurchaseUnit: boolean; isActive?: boolean }) => {
      const isEdit = !!payload.id;
      const url = isEdit ? `/products/${productId}/units/${payload.id}` : `/products/${productId}/units`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        if (res.status === 409 || body.error?.code === "UNIT_FACTOR_LOCKED") {
          throw new Error("বিক্রয় বা ক্রয় অর্ডারে ব্যবহৃত এককের রূপান্তর ফ্যাক্টর পরিবর্তন করা যাবে না। অনুগ্রহ করে একটি নতুন একক তৈরি করুন।");
        }
        throw new Error(body.error?.message || "Failed to save unit");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setIsUnitModalOpen(false);
      setEditingUnit(null);
      setActionSuccess("একক সফলভাবে সংরক্ষিত হয়েছে");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Set Variant Unit Price Override
  const setVariantUnitPriceMutation = useMutation({
    mutationFn: async ({ variantId, unitId, priceMinor }: { variantId: string; unitId: string; priceMinor: number }) => {
      const res = await apiFetch(`/variants/${variantId}/units/${unitId}/price`, {
        method: "PUT",
        body: JSON.stringify({ priceMinor }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to set unit price");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setPriceOverrideModal(null);
      setActionSuccess("এককের বিশেষ মূল্য নির্ধারণ করা হয়েছে");
      setTimeout(() => setActionSuccess(null), 3000);
    },
    onError: (err: any) => {
      setActionError(err.message);
    },
  });

  // Clear Variant Unit Price Override
  const clearVariantUnitPriceMutation = useMutation({
    mutationFn: async ({ variantId, unitId }: { variantId: string; unitId: string }) => {
      const res = await apiFetch(`/variants/${variantId}/units/${unitId}/price`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Failed to clear unit price");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
      setPriceOverrideModal(null);
      setActionSuccess("এককের নির্ধারিত মূল্য মুছে ফেলা হয়েছে");
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
          {isBn ? "পণ্যটি খুঁজে পাওয়া যায়নি।" : "Product not found."}
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
                {product.category?.name || (isBn ? "ক্যাটাগরি নেই" : "No category")} • {product.brand?.name || (isBn ? "ব্র্যান্ড নেই" : "No brand")} • {variants.length} {isBn ? "টি ভ্যারিয়েন্ট" : "variants"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsBarcodePrintOpen(true)}
              className="flex items-center gap-1.5"
              data-testid="print-barcodes-button"
            >
              <Printer className="h-4 w-4" />
              <span>{isBn ? "বারকোড প্রিন্ট" : "Print Barcodes"}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsBulkPriceOpen(true)}
              className="flex items-center gap-1.5"
            >
              <DollarSign className="h-4 w-4" />
              <span>{isBn ? "একসাথে মূল্য পরিবর্তন" : "Bulk Price Update"}</span>
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
                <span>{isBn ? "সাইজ ও কালার ভিত্তিক বর্তমান স্টক" : "Size & Colour Stock Matrix"}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {isBn ? "সবুজ: পর্যাপ্ত স্টক | হলুদ: কম স্টক | লাল: শূন্য" : "Green: In stock | Amber: Low stock | Red: Out of stock"}
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

        {/* Units and Conversions Section */}
        {isUnitsActive && (
          <Card className="shadow-sm" data-testid="units-management-card">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <span>{isBn ? "একক ও পরিমাপ (Units & Packing)" : "Units & Packing"}</span>
                  <Badge variant="outline" className="text-xs">Module: Units</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isBn
                    ? "পণ্যটির বেস একক, দশমিক অনুমতি এবং বিভিন্ন প্যাকিং একক ও মূল্য নির্ধারণ করুন"
                    : "Configure base unit, decimal quantities, and packing units"}
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1 text-xs"
                data-testid="add-unit-button"
                onClick={() => {
                  setEditingUnit(null);
                  setUnitName("");
                  setUnitFactor("");
                  setUnitIsSale(true);
                  setUnitIsPurchase(true);
                  setUnitIsActive(true);
                  setIsUnitModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{isBn ? "নতুন একক যোগ করুন" : "Add Packing Unit"}</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Base Unit & Decimal Qty settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/30 border">
                <div className="space-y-1.5">
                  <Label htmlFor="detailBaseUnit" className="text-xs font-semibold">
                    {isBn ? "বেস একক (Base Unit)" : "Base Unit"}
                  </Label>
                  <div className="flex items-center gap-2">
                    <select
                      id="detailBaseUnit"
                      value={product.baseUnit || "pcs"}
                      onChange={(e) => {
                        updateProductSettingsMutation.mutate({ baseUnit: e.target.value });
                      }}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                      data-testid="detail-base-unit-select"
                    >
                      {BASE_UNITS.map((u) => (
                        <option key={u.code} value={u.code}>
                          {isBn ? `${u.nameBn} (${u.code})` : `${u.nameEn} (${u.code})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {isBn
                      ? "স্টক মুভমেন্ট বা বিক্রয় হয়ে গেলে বেস একক পরিবর্তন করা যাবে না।"
                      : "Cannot change base unit once stock movements or sales exist."}
                  </p>
                </div>

                <div className="flex flex-col justify-center space-y-1.5">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="detailAllowDecimal"
                      checked={Boolean(product.allowDecimalQty)}
                      onChange={(e) => {
                        updateProductSettingsMutation.mutate({ allowDecimalQty: e.target.checked });
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                      data-testid="detail-allow-decimal-switch"
                    />
                    <Label htmlFor="detailAllowDecimal" className="text-xs font-semibold cursor-pointer">
                      {isBn ? "ভগ্নাংশ বা দশমিক পরিমাণ অনুমোদন করুন (Allow Decimal Qty)" : "Allow Decimal Quantity"}
                    </Label>
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-6">
                    {isBn ? "সক্রিয় থাকলে ২.৫ কেজি ইত্যাদি দশমিক বিক্রি সম্ভব।" : "Enables fractional quantities (e.g. 2.5 kg)."}
                  </p>
                </div>
              </div>

              {/* Packing Units Table */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {isBn ? "প্যাকিং এককসমূহ (Units)" : "Packing Units"}
                </h3>
                <div className="rounded-md border overflow-hidden">
                  <Table data-testid="product-units-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{isBn ? "এককের নাম" : "Unit Name"}</TableHead>
                        <TableHead>{isBn ? "রূপান্তর ফ্যাক্টর" : "Factor"}</TableHead>
                        <TableHead className="text-center">{isBn ? "বিক্রয় একক" : "Sale Unit"}</TableHead>
                        <TableHead className="text-center">{isBn ? "ক্রয় একক" : "Purchase Unit"}</TableHead>
                        <TableHead className="text-center">{isBn ? "অবস্থা" : "Status"}</TableHead>
                        <TableHead className="text-right">{isBn ? "ভ্যারিয়েন্ট মূল্য ও ওভাররাইড" : "Variant Prices"}</TableHead>
                        <TableHead className="text-right w-24">{strings.common.actions}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!product.units || product.units.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">
                            {isBn ? "কোনো অতিরিক্ত একক নেই (শুধুমাত্র বেস এককে বিক্রি/ক্রয় হয়)" : "No additional packing units."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        product.units.map((u: any) => {
                          const baseDef = getBaseUnit(product.baseUnit || "pcs");
                          const baseLabel = isBn ? (baseDef?.nameBn || product.baseUnit) : (baseDef?.nameEn || product.baseUnit);
                          const factorFormula = `১ ${u.name} = ${u.factor} ${baseLabel}`;

                          return (
                            <TableRow key={u.id} data-testid="unit-row">
                              <TableCell className="font-semibold text-xs text-foreground">
                                {u.name}
                              </TableCell>
                              <TableCell className="text-xs font-mono">
                                <Badge variant="secondary" className="font-mono text-xs">
                                  {factorFormula}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center text-xs">
                                {u.isSaleUnit ? (
                                  <Badge variant="outline" className="text-[11px] bg-emerald-500/10 text-emerald-600">হ্যাঁ</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[11px] text-muted-foreground">না</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-xs">
                                {u.isPurchaseUnit ? (
                                  <Badge variant="outline" className="text-[11px] bg-emerald-500/10 text-emerald-600">হ্যাঁ</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[11px] text-muted-foreground">না</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-xs">
                                <Badge variant={u.isActive ? "success" : "outline"} className="text-[11px]">
                                  {u.isActive ? strings.common.active : strings.common.inactive}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                <div className="flex flex-col gap-1 items-end">
                                  {variants.map((v: any) => {
                                    const override = v.unitPrices?.find((up: any) => up.productUnitId === u.id);
                                    const derivedPrice = computeUnitDerivedPriceMinor(v.priceMinor, u.factor);
                                    return (
                                      <div key={v.id} className="flex items-center gap-1.5 font-mono text-[11px]">
                                        <span className="text-muted-foreground">{v.sku}:</span>
                                        {override ? (
                                          <span className="font-bold text-primary">
                                            {formatMoney(override.priceMinor)}
                                            <span className="text-[10px] text-muted-foreground ml-1">(override)</span>
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">
                                            {formatMoney(derivedPrice)}
                                            <span className="text-[10px] text-muted-foreground ml-1">(derived)</span>
                                          </span>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-5 px-1.5 text-[10px]"
                                          onClick={() => {
                                            setPriceOverrideModal({
                                              variant: v,
                                              unit: u,
                                              currentPriceMinor: override ? Number(override.priceMinor) : null,
                                              derivedPriceMinor: Number(derivedPrice),
                                            });
                                            setOverridePriceTaka(override ? (Number(override.priceMinor) / 100).toString() : (Number(derivedPrice) / 100).toString());
                                          }}
                                        >
                                          {override ? "বদলান" : "মূল্য নির্ধারণ"}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs px-2 gap-1"
                                  onClick={() => {
                                    setEditingUnit(u);
                                    setUnitName(u.name);
                                    setUnitFactor(String(u.factor));
                                    setUnitIsSale(u.isSaleUnit);
                                    setUnitIsPurchase(u.isPurchaseUnit);
                                    setUnitIsActive(u.isActive);
                                    setIsUnitModalOpen(true);
                                  }}
                                >
                                  <Edit2 className="h-3 w-3" />
                                  <span>{strings.common.edit}</span>
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
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
                  <TableHead>{isBn ? "অপশন" : "Options"}</TableHead>
                  <TableHead className="text-right">{strings.products.price}</TableHead>
                  {canSeeCost && <TableHead className="text-right">{strings.products.costPrice}</TableHead>}
                  <TableHead className="w-[240px]">{strings.products.barcode}</TableHead>
                  <TableHead className="text-right">{strings.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v: any) => {
                  const opts = v.optionValues || [];
                  const optionsLabel = opts.length > 0
                    ? opts.map((vov: any) => `${vov.optionValue?.option?.name}: ${vov.optionValue?.value}`).join(", ")
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
                                {b.productUnit?.name && (
                                  <span className="text-[10px] text-primary font-sans font-medium">
                                    ({b.productUnit.name})
                                  </span>
                                )}
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
                            <span className="text-[11px] text-muted-foreground">{isBn ? "বারকোড নেই" : "No barcode"}</span>
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
                          <span>{isBn ? "মূল্য পরিবর্তন" : "Edit Price"}</span>
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
                  {isBn ? "নতুন বারকোড যোগ করুন" : "Add New Barcode"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="barcodeInput">
                    {isBn ? "বারকোড নম্বর (টাইপ বা স্ক্যান করুন)" : "Barcode number (type or scan)"}
                  </Label>
                  <Input
                    id="barcodeInput"
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder="e.g. 890123456789"
                    autoFocus
                  />
                </div>
                {isUnitsActive && (
                  <div className="space-y-1.5">
                    <Label htmlFor="barcodeUnitSelect">
                      {isBn ? "একক নির্বাচন (ঐচ্ছিক)" : "Unit Selection (Optional)"}
                    </Label>
                    <select
                      id="barcodeUnitSelect"
                      value={barcodeUnitId}
                      onChange={(e) => setBarcodeUnitId(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                      data-testid="barcode-unit-select"
                    >
                      <option value="">{isBn ? `বেস একক (${product.baseUnit || "pcs"})` : `Base Unit (${product.baseUnit || "pcs"})`}</option>
                      {(product.units || [])
                        .filter((u: any) => u.isActive)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.name} (১ {u.name} = {u.factor} {getBaseUnit(product.baseUnit || "pcs")?.nameBn || product.baseUnit})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setBarcodeVariantId(null)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!newBarcode.trim() || addBarcodeMutation.isPending}
                    onClick={() => addBarcodeMutation.mutate({ variantId: barcodeVariantId, barcode: newBarcode.trim(), productUnitId: barcodeUnitId || undefined })}
                  >
                    {isBn ? "যোগ করুন" : "Add"}<span className="sr-only"> (Add)</span>
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
                  {isBn ? `ভ্যারিয়েন্ট মূল্য পরিবর্তন (${editingVariant.sku})` : `Edit Variant Price (${editingVariant.sku})`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editPriceInput">{isBn ? "বিক্রয় মূল্য (৳)" : "Selling Price (৳)"}</Label>
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
                  {isBn ? "একসাথে সকল ভ্যারিয়েন্টের মূল্য পরিবর্তন" : "Bulk Price Update for All Variants"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {isBn
                    ? `এই পণ্যের সকল ${variants.length} টি ভ্যারিয়েন্টের বিক্রয় মূল্য একসাথে পরিবর্তন করা হবে।`
                    : `Selling price will be updated for all ${variants.length} variants of this product.`}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="bulkPriceInput">{isBn ? "নতুন সাধারণ বিক্রয় মূল্য (৳)" : "New Selling Price (৳)"}</Label>
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

        {/* Add/Edit Unit Modal */}
        {isUnitModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">
                  {editingUnit ? (isBn ? "একক পরিবর্তন করুন" : "Edit Unit") : (isBn ? "নতুন প্যাকিং একক যোগ করুন" : "Add Packing Unit")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="unitNameInput">{isBn ? "এককের নাম" : "Unit Name"} *</Label>
                  <Input
                    id="unitNameInput"
                    placeholder="যেমন: ড্রাম, বস্তা, 5 লিটার ক্যান"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    data-testid="unit-name-input"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="unitFactorInput">
                    {isBn ? `রূপান্তর ফ্যাক্টর (প্রতি এককে কত ${getBaseUnit(product.baseUnit || "pcs")?.nameBn || product.baseUnit})` : `Conversion Factor (base units per 1 of this unit)`} *
                  </Label>
                  <Input
                    id="unitFactorInput"
                    type="number"
                    step="0.001"
                    min="0.001"
                    placeholder="যেমন: 200 বা 25"
                    value={unitFactor}
                    onChange={(e) => setUnitFactor(e.target.value)}
                    data-testid="unit-factor-input"
                  />
                  {unitName.trim() && unitFactor && (
                    <p className="text-xs text-primary font-medium">
                      ১ {unitName} = {unitFactor} {getBaseUnit(product.baseUnit || "pcs")?.nameBn || product.baseUnit}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <label className="flex items-center space-x-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unitIsSale}
                      onChange={(e) => setUnitIsSale(e.target.checked)}
                      className="rounded border-gray-300"
                      data-testid="unit-sale-checkbox"
                    />
                    <span>{isBn ? "বিক্রয়ে প্রযোজ্য" : "Sale Unit"}</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unitIsPurchase}
                      onChange={(e) => setUnitIsPurchase(e.target.checked)}
                      className="rounded border-gray-300"
                      data-testid="unit-purchase-checkbox"
                    />
                    <span>{isBn ? "ক্রয়ে প্রযোজ্য" : "Purchase Unit"}</span>
                  </label>
                </div>

                {editingUnit && (
                  <label className="flex items-center space-x-2 text-xs cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={unitIsActive}
                      onChange={(e) => setUnitIsActive(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span>{isBn ? "সক্রিয় রাখুন" : "Active"}</span>
                  </label>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setIsUnitModalOpen(false)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!unitName.trim() || !unitFactor || isNaN(parseFloat(unitFactor)) || parseFloat(unitFactor) <= 0 || saveUnitMutation.isPending}
                    data-testid="btn-save-unit"
                    onClick={() => {
                      saveUnitMutation.mutate({
                        id: editingUnit?.id,
                        name: unitName.trim(),
                        factor: parseFloat(unitFactor),
                        isSaleUnit: unitIsSale,
                        isPurchaseUnit: unitIsPurchase,
                        isActive: unitIsActive,
                      });
                    }}
                  >
                    {strings.common.save}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Variant Unit Price Override Modal */}
        {priceOverrideModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-sm shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">
                  {isBn
                    ? `এককের বিশেষ মূল্য নির্ধারণ (${priceOverrideModal.unit.name})`
                    : `Set Unit Price Override (${priceOverrideModal.unit.name})`}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  ভ্যারিয়েন্ট: {priceOverrideModal.variant.sku}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="overridePriceInput">
                    {isBn ? "বিক্রয় মূল্য (৳)" : "Selling Price (৳)"}
                  </Label>
                  <Input
                    id="overridePriceInput"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`স্বাভাবিক মূল্য: ৳${(priceOverrideModal.derivedPriceMinor / 100).toFixed(2)}`}
                    value={overridePriceTaka}
                    onChange={(e) => setOverridePriceTaka(e.target.value)}
                    autoFocus
                    data-testid="override-price-input"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    বেস মূল্য অনুযায়ী হিসাবকৃত মূল্য: ৳{(priceOverrideModal.derivedPriceMinor / 100).toFixed(2)}
                  </p>
                </div>

                <div className="flex justify-between items-center pt-2">
                  {priceOverrideModal.currentPriceMinor !== null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 text-xs"
                      onClick={() => {
                        clearVariantUnitPriceMutation.mutate({
                          variantId: priceOverrideModal.variant.id,
                          unitId: priceOverrideModal.unit.id,
                        });
                      }}
                    >
                      {isBn ? "ওভাররাইড মুছুন" : "Clear Override"}
                    </Button>
                  ) : <div />}

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPriceOverrideModal(null)}>
                      {strings.common.cancel}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!overridePriceTaka || isNaN(parseFloat(overridePriceTaka)) || parseFloat(overridePriceTaka) < 0}
                      data-testid="save-override-price-btn"
                      onClick={() => {
                        const minor = Math.round(parseFloat(overridePriceTaka) * 100);
                        setVariantUnitPriceMutation.mutate({
                          variantId: priceOverrideModal.variant.id,
                          unitId: priceOverrideModal.unit.id,
                          priceMinor: minor,
                        });
                      }}
                    >
                      {strings.common.save}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Barcode Print Modal */}
        <BarcodePrintModal
          isOpen={isBarcodePrintOpen}
          onClose={() => setIsBarcodePrintOpen(false)}
          shopName="Universal POS"
          items={variants.map((v: any) => ({
            variantId: v.id,
            productId: product.id,
            productName: product.name,
            variantName:
              v.optionValues?.map((ov: any) => ov.optionValue?.name).filter(Boolean).join(" / ") ||
              v.sku ||
              "Default",
            priceMinor: v.priceMinor,
            barcode: v.barcodes?.[0]?.barcode,
            quantity: 1,
          }))}
          onBarcodesUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["product", productId] });
          }}
        />
      </div>
    </PermissionGate>
  );
}
