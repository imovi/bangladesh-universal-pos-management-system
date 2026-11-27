"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, X, AlertCircle, Copy } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { sortSizes, BASE_UNITS } from "@universal-pos/shared";
import { useModules } from "@/lib/auth-context";

const NewProductFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  sku: z.string().trim().min(2, "SKU must be at least 2 characters"),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  brandId: z.string().uuid().optional().or(z.literal("")),
  collectionId: z.string().uuid().optional().or(z.literal("")),
  taxClassId: z.string().uuid().optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  cost: z.coerce.number().min(0).optional(),
  reorderLevel: z.coerce.number().min(0).default(5),
});

type NewProductFormValues = z.infer<typeof NewProductFormSchema>;

interface VariantRowState {
  key: string;
  size: string;
  color: string;
  enabled: boolean;
  sku: string;
  price: string;
  cost: string;
  barcode: string;
}

export default function NewProductPage() {
  const router = useRouter();
  const { strings, locale } = useTranslation();
  const isBn = locale === "bn";
  const { apiFetch, hasPermission } = useAuth();
  const { isModuleActive } = useModules();
  const isUnitsActive = isModuleActive("units");

  const [baseUnit, setBaseUnit] = useState("pcs");
  const [allowDecimalQty, setAllowDecimalQty] = useState(false);
  const [sizes, setSizes] = useState<string[]>(["S", "M", "L", "XL"]);
  const [colors, setColors] = useState<string[]>(["Black", "Navy", "White"]);
  const [newSizeInput, setNewSizeInput] = useState("");
  const [newColorInput, setNewColorInput] = useState("");
  const [variantRows, setVariantRows] = useState<Record<string, VariantRowState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch Metadata for dropdowns
  const { data: categories = [] } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/categories");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["catalog-brands"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/brands");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: taxClasses = [] } = useQuery({
    queryKey: ["catalog-tax-classes"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/tax-classes");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<NewProductFormValues>({
    resolver: zodResolver(NewProductFormSchema),
    defaultValues: {
      name: "",
      sku: "",
      description: "",
      categoryId: "",
      brandId: "",
      collectionId: "",
      taxClassId: "",
      price: undefined,
      cost: undefined,
      reorderLevel: 5,
    },
  });

  const baseSku = watch("sku") || "";
  const basePrice = watch("price");
  const baseCost = watch("cost");
  const canSeeCost = hasPermission("report.profit") || hasPermission("purchase.read");

  // Keep variant rows in sync when sizes/colors change
  useEffect(() => {
    setVariantRows((prev) => {
      const updated: Record<string, VariantRowState> = {};
      for (const color of colors) {
        for (const size of sizes) {
          const key = `${color}:${size}`;
          const cleanColor = color.trim().slice(0, 3).toUpperCase();
          const cleanSize = size.trim().toUpperCase();
          const suggestedSku = baseSku ? `${baseSku.toUpperCase()}-${cleanSize}-${cleanColor}` : "";

          if (prev[key]) {
            updated[key] = {
              ...prev[key],
              sku: prev[key].sku || suggestedSku,
            };
          } else {
            updated[key] = {
              key,
              size,
              color,
              enabled: true,
              sku: suggestedSku,
              price: basePrice !== undefined ? String(basePrice) : "",
              cost: baseCost !== undefined ? String(baseCost) : "",
              barcode: "",
            };
          }
        }
      }
      return updated;
    });
  }, [sizes, colors, baseSku]);

  const combinations = useMemo(() => {
    const list: VariantRowState[] = [];
    for (const color of colors) {
      for (const size of sizes) {
        const key = `${color}:${size}`;
        if (variantRows[key]) {
          list.push(variantRows[key]);
        }
      }
    }
    return list;
  }, [sizes, colors, variantRows]);

  const handleAddSize = () => {
    const trimmed = newSizeInput.trim().toUpperCase();
    if (trimmed && !sizes.includes(trimmed)) {
      setSizes(sortSizes([...sizes, trimmed]));
      setNewSizeInput("");
    }
  };

  const handleRemoveSize = (s: string) => {
    setSizes(sizes.filter((x) => x !== s));
  };

  const handleAddColor = () => {
    const trimmed = newColorInput.trim();
    if (trimmed && !colors.includes(trimmed)) {
      setColors([...colors, trimmed]);
      setNewColorInput("");
    }
  };

  const handleRemoveColor = (c: string) => {
    setColors(colors.filter((x) => x !== c));
  };

  // Bulk Apply Functions
  const applyToAll = (sourceRow: VariantRowState) => {
    setVariantRows((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = {
          ...next[k],
          price: sourceRow.price,
          cost: sourceRow.cost,
        };
      }
      return next;
    });
  };

  const applyToColor = (sourceRow: VariantRowState) => {
    setVariantRows((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].color === sourceRow.color) {
          next[k] = {
            ...next[k],
            price: sourceRow.price,
            cost: sourceRow.cost,
          };
        }
      }
      return next;
    });
  };

  const applyToSize = (sourceRow: VariantRowState) => {
    setVariantRows((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].size === sourceRow.size) {
          next[k] = {
            ...next[k],
            price: sourceRow.price,
            cost: sourceRow.cost,
          };
        }
      }
      return next;
    });
  };

  const onSubmit = async (values: NewProductFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const optionsInput = [];
      if (sizes.length > 0) {
        optionsInput.push({ name: "Size", values: sizes });
      }
      if (colors.length > 0) {
        optionsInput.push({ name: "Colour", values: colors });
      }

      // Collect configured variant rows
      const enabledVariants = Object.values(variantRows).filter((v) => v.enabled);
      const variantsPayload = enabledVariants.map((v) => ({
        sku: v.sku.trim() || `${values.sku.toUpperCase()}-${v.size}-${v.color.slice(0, 3).toUpperCase()}`,
        priceMinor: Math.round((Number(v.price) || values.price || 0) * 100),
        costMinor: canSeeCost && v.cost ? Math.round(Number(v.cost) * 100) : (values.cost ? Math.round(values.cost * 100) : 0),
        reorderLevel: values.reorderLevel,
        barcode: v.barcode.trim() || null,
        optionValues: {
          Size: v.size,
          Colour: v.color,
        },
        isActive: true,
      }));

      const payload: any = {
        name: values.name,
        description: values.description || null,
        categoryId: values.categoryId || null,
        brandId: values.brandId || null,
        taxClassId: values.taxClassId || null,
        sku: values.sku.toUpperCase(),
        priceMinor: Math.round((values.price || 0) * 100),
        costMinor: values.cost ? Math.round(values.cost * 100) : 0,
        reorderLevel: values.reorderLevel,
        options: optionsInput.length > 0 ? optionsInput : undefined,
        variants: variantsPayload.length > 0 ? variantsPayload : undefined,
      };

      if (isUnitsActive) {
        payload.baseUnit = baseUnit;
        payload.allowDecimalQty = allowDecimalQty;
      }

      const res = await apiFetch("/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        setErrorMessage(body.error?.message || "Failed to create product");
        setIsSubmitting(false);
        return;
      }

      const createdProduct = body.data;
      router.push(`/catalog/products/${createdProduct.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || "Network error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <PermissionGate permission="catalog.read">
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/catalog/products">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {strings.products.createProduct}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isBn
                  ? "নতুন পোশাক বা পণ্যের তথ্য ও সাইজ-রঙের ভ্যারিয়েন্ট তৈরি করুন"
                  : "Add new fashion product with size and colour variants"}
              </p>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Base Product Information */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                {isBn ? "সাধারণ বিবরণ" : "Product Basics"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-sm font-medium">
                    {strings.products.productName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g. Oxford Cotton Shirt"
                    {...register("name")}
                    aria-invalid={!!errors.name}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sku" className="text-sm font-medium">
                    {strings.products.sku} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sku"
                    placeholder="e.g. SHT-OXF-01"
                    className="font-mono uppercase"
                    {...register("sku")}
                    aria-invalid={!!errors.sku}
                  />
                  {errors.sku && (
                    <p className="text-xs text-destructive mt-1">{errors.sku.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="categoryId" className="text-sm font-medium">
                    {strings.products.category}
                  </Label>
                  <Select
                    value={watch("categoryId") || ""}
                    onValueChange={(val) => setValue("categoryId", val)}
                  >
                    <SelectTrigger id="categoryId" className="h-9">
                      <SelectValue placeholder={strings.selectEmpty.chooseCategory} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="brandId" className="text-sm font-medium">
                    {strings.products.brand}
                  </Label>
                  <Select
                    value={watch("brandId") || ""}
                    onValueChange={(val) => setValue("brandId", val)}
                  >
                    <SelectTrigger id="brandId" className="h-9">
                      <SelectValue placeholder={strings.selectEmpty.chooseBrand} />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="taxClassId" className="text-sm font-medium">
                    {strings.products.taxClass}
                  </Label>
                  <Select
                    value={watch("taxClassId") || ""}
                    onValueChange={(val) => setValue("taxClassId", val)}
                  >
                    <SelectTrigger id="taxClassId" className="h-9">
                      <SelectValue placeholder={isBn ? "ট্যাক্স ক্লাস বেছে নিন" : "Choose a tax class"} />
                    </SelectTrigger>
                    <SelectContent>
                      {taxClasses.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.rateBp / 100}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reorderLevel" className="text-sm font-medium">
                    {strings.inventory.reorderLevel}
                  </Label>
                  <Input
                    id="reorderLevel"
                    type="number"
                    min={0}
                    placeholder="5"
                    {...register("reorderLevel")}
                  />
                </div>
              </div>

              {/* Pricing Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <Label htmlFor="price" className="text-sm font-medium">
                    {strings.products.price} <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground select-none">
                      ৳
                    </span>
                    <Input
                      id="price"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7 font-mono tabular-nums"
                      {...register("price")}
                      aria-invalid={!!errors.price}
                    />
                  </div>
                  {errors.price && (
                    <p className="text-xs text-destructive mt-1">{errors.price.message}</p>
                  )}
                </div>

                {canSeeCost && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cost" className="text-sm font-medium">
                      {strings.products.costPrice}
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground select-none">
                        ৳
                      </span>
                      <Input
                        id="cost"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        className="pl-7 font-mono tabular-nums"
                        {...register("cost")}
                      />
                    </div>
                  </div>
                )}
              </div>

              {isUnitsActive && (
                <div className="p-4 rounded-lg border bg-muted/20 space-y-4 mt-2">
                  <div className="font-semibold text-sm flex items-center justify-between">
                    <span>{isBn ? "একক ও পরিমাপ (Units & Measurement)" : "Units & Measurement"}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">Module: Units</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="baseUnit" className="text-sm font-medium">
                        {isBn ? "বেস একক (Base Unit)" : "Base Unit"}
                      </Label>
                      <select
                        id="baseUnit"
                        value={baseUnit}
                        onChange={(e) => setBaseUnit(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        data-testid="product-base-unit-select"
                      >
                        {BASE_UNITS.map((u) => (
                          <option key={u.code} value={u.code}>
                            {isBn ? `${u.nameBn} (${u.code})` : `${u.nameEn} (${u.code})`}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground">
                        {isBn ? "মজুদ সর্বদা বেস এককে সংরক্ষিত হয়।" : "Stock is always kept in base units."}
                      </p>
                    </div>

                    <div className="flex flex-col justify-center space-y-1.5 pt-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="allowDecimalQty"
                          checked={allowDecimalQty}
                          onChange={(e) => setAllowDecimalQty(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          data-testid="product-allow-decimal-switch"
                        />
                        <Label htmlFor="allowDecimalQty" className="text-sm font-medium cursor-pointer">
                          {isBn ? "ভগ্নাংশ বা দশমিক পরিমাণ অনুমোদন করুন" : "Allow Decimal Quantity"}
                        </Label>
                      </div>
                      <p className="text-[11px] text-muted-foreground pl-6">
                        {isBn ? "যেমন: ২.৫ কেজি বা ১.৭৫ লিটার বিক্রি করা যাবে।" : "Allows selling quantities like 2.5 kg or 1.75 liters."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Size & Colour Options Tags Builder */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                {strings.products.options}
              </CardTitle>
              <CardDescription className="text-xs">
                {isBn
                  ? "যেসব সাইজ এবং রঙে পণ্যটি তৈরি বা মজুদ আছে তা যোগ করুন"
                  : "Specify available sizes and colours to generate variant combinations"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Sizes builder */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">{strings.products.sizes}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {sizes.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-semibold"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => handleRemoveSize(s)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      value={newSizeInput}
                      onChange={(e) => setNewSizeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddSize();
                        }
                      }}
                      placeholder="e.g. XXL"
                      className="h-8 w-24 text-xs uppercase"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddSize}
                      className="h-8 px-2.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>{strings.common.create}</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Colours builder */}
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs font-semibold">{strings.products.colors}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {colors.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"
                    >
                      {c}
                      <button
                        type="button"
                        onClick={() => handleRemoveColor(c)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      value={newColorInput}
                      onChange={(e) => setNewColorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddColor();
                        }
                      }}
                      placeholder="e.g. Maroon"
                      className="h-8 w-28 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddColor}
                      className="h-8 px-2.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>{strings.common.create}</span>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Variant Rows Table with shortcuts */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">
                    {isBn ? "ভ্যারিয়েন্ট তালিকা ও কনফিগারেশন" : "Variant Rows & Pricing"}
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {isBn
                      ? "প্রতিটি ভ্যারিয়েন্টের এসকেইউ, মূল্য, ক্রয়মূল্য ও বারকোড নির্ধারণ করুন"
                      : "Configure individual SKU, price, cost and barcode for each stocked combination"}
                  </CardDescription>
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  {combinations.filter((c) => c.enabled).length} / {combinations.length} {isBn ? "ভ্যারিয়েন্ট সক্রিয়" : "variants active"}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={combinations.length > 0 && combinations.every((c) => c.enabled)}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setVariantRows((prev) => {
                              const next = { ...prev };
                              for (const k of Object.keys(next)) {
                                next[k] = { ...next[k], enabled: val };
                              }
                              return next;
                            });
                          }}
                          className="rounded border-input cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-3 text-left font-semibold w-32">
                        {isBn ? "কম্বিনেশন" : "Combination"}
                      </th>
                      <th className="py-2.5 px-3 text-left font-semibold">
                        {strings.products.sku}
                      </th>
                      <th className="py-2.5 px-3 text-left font-semibold w-32">
                        {strings.products.price} (৳)
                      </th>
                      {canSeeCost && (
                        <th className="py-2.5 px-3 text-left font-semibold w-32">
                          {strings.products.costPrice} (৳)
                        </th>
                      )}
                      <th className="py-2.5 px-3 text-left font-semibold w-40">
                        {strings.products.barcode}
                      </th>
                      <th className="py-2.5 px-3 text-right font-semibold w-36">
                        {strings.common.actions}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {combinations.map((row) => (
                      <tr
                        key={row.key}
                        className={`transition-colors h-[48px] ${
                          row.enabled ? "hover:bg-muted/30" : "opacity-50 bg-muted/10"
                        }`}
                      >
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setVariantRows((prev) => ({
                                ...prev,
                                [row.key]: { ...prev[row.key], enabled: val },
                              }));
                            }}
                            className="rounded border-input cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3 font-semibold text-foreground">
                          {row.size} / {row.color}
                        </td>
                        <td className="py-2 px-3">
                          <Input
                            value={row.sku}
                            disabled={!row.enabled}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              setVariantRows((prev) => ({
                                ...prev,
                                [row.key]: { ...prev[row.key], sku: val },
                              }));
                            }}
                            className="h-8 font-mono text-xs uppercase"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-[11px] font-semibold text-muted-foreground select-none">
                              ৳
                            </span>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={row.price}
                              disabled={!row.enabled}
                              onChange={(e) => {
                                const val = e.target.value;
                                setVariantRows((prev) => ({
                                ...prev,
                                [row.key]: { ...prev[row.key], price: val },
                              }));
                              }}
                              className="h-8 pl-6 text-xs font-mono tabular-nums"
                            />
                          </div>
                        </td>
                        {canSeeCost && (
                          <td className="py-2 px-3">
                            <div className="relative">
                              <span className="absolute left-2.5 top-2 text-[11px] font-semibold text-muted-foreground select-none">
                                ৳
                              </span>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.cost}
                                disabled={!row.enabled}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setVariantRows((prev) => ({
                                    ...prev,
                                    [row.key]: { ...prev[row.key], cost: val },
                                  }));
                                }}
                                className="h-8 pl-6 text-xs font-mono tabular-nums"
                              />
                            </div>
                          </td>
                        )}
                        <td className="py-2 px-3">
                          <Input
                            value={row.barcode}
                            disabled={!row.enabled}
                            placeholder="e.g. 8941234567"
                            onChange={(e) => {
                              const val = e.target.value;
                              setVariantRows((prev) => ({
                                ...prev,
                                [row.key]: { ...prev[row.key], barcode: val },
                              }));
                            }}
                            className="h-8 font-mono text-xs"
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applyToAll(row)}
                              title={strings.products.applyToAll}
                              className="h-7 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              <Copy className="h-3 w-3 mr-0.5" />
                              <span>{isBn ? "সবগুলোতে" : "All"}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applyToColor(row)}
                              title={strings.products.applyToColour}
                              className="h-7 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              <span>{row.color}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applyToSize(row)}
                              title={strings.products.applyToSize}
                              className="h-7 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              <span>{row.size}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Form Actions: Desktop bottom-right, Mobile full-width */}
          <div className="flex flex-col-reverse sm:flex-row items-center sm:justify-end gap-3 pt-2">
            <Link href="/catalog/products" className="w-full sm:w-auto">
              <Button type="button" variant="ghost" className="w-full sm:w-auto text-muted-foreground">
                {strings.common.cancel}
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-6 h-10 font-semibold"
            >
              {isSubmitting ? strings.common.loading : strings.products.createProduct}
            </Button>
          </div>
        </form>
      </div>
    </PermissionGate>
  );
}
