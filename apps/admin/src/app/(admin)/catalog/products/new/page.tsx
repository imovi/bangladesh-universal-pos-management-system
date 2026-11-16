"use client";

import React, { useState } from "react";
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
import { SizeColorGrid, type GridCellData } from "@/components/common/size-color-grid";
import { ArrowLeft, Plus, X, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

const NewProductFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  sku: z.string().trim().min(2, "SKU must be at least 2 characters"),
  description: z.string().optional(),
  categoryId: z.string().uuid("Category is required").optional().or(z.literal("")),
  brandId: z.string().uuid().optional().or(z.literal("")),
  collectionId: z.string().uuid().optional().or(z.literal("")),
  taxClassId: z.string().uuid().optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  cost: z.coerce.number().min(0).optional(),
  reorderLevel: z.coerce.number().min(0).default(5),
});

type NewProductFormValues = z.infer<typeof NewProductFormSchema>;

export default function NewProductPage() {
  const router = useRouter();
  const { strings, locale } = useTranslation();
  const { apiFetch, hasPermission } = useAuth();

  const [sizes, setSizes] = useState<string[]>(["S", "M", "L", "XL"]);
  const [colors, setColors] = useState<string[]>(["Black", "Navy", "White"]);
  const [newSizeInput, setNewSizeInput] = useState("");
  const [newColorInput, setNewColorInput] = useState("");
  const [matrix, setMatrix] = useState<Record<string, GridCellData>>({});
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
      price: 1500,
      cost: 950,
      reorderLevel: 5,
    },
  });

  const basePrice = watch("price") || 1500;
  const canSeeCost = hasPermission("report.profit") || hasPermission("purchase.read");

  const handleAddSize = () => {
    const trimmed = newSizeInput.trim().toUpperCase();
    if (trimmed && !sizes.includes(trimmed)) {
      setSizes([...sizes, trimmed]);
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

  const handleMatrixChange = (color: string, size: string, value: number) => {
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
        value: prev[key]?.value ?? Math.round(basePrice * 100),
        disabled: !enabled,
      },
    }));
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

      const payload: any = {
        name: values.name,
        description: values.description || null,
        categoryId: values.categoryId || null,
        brandId: values.brandId || null,
        taxClassId: values.taxClassId || null,
        sku: values.sku.toUpperCase(),
        priceMinor: Math.round(values.price * 100),
        costMinor: values.cost ? Math.round(values.cost * 100) : 0,
        reorderLevel: values.reorderLevel,
        options: optionsInput.length > 0 ? optionsInput : undefined,
      };

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
              <h1 className="text-2xl font-bold tracking-tight">
                {strings.products.createProduct}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {locale === "bn"
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
              <CardTitle className="text-base font-bold">
                {locale === "bn" ? "সাধারণ বিবরণ" : "Product Basics"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">{strings.products.productName} *</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Oxford Cotton Shirt"
                    {...register("name")}
                    aria-invalid={!!errors.name}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sku">{strings.products.sku} (Base) *</Label>
                  <Input
                    id="sku"
                    placeholder="e.g. SHT-OXF-01"
                    className="font-mono uppercase"
                    {...register("sku")}
                    aria-invalid={!!errors.sku}
                  />
                  {errors.sku && (
                    <p className="text-xs text-destructive">{errors.sku.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="categoryId">{strings.products.category}</Label>
                  <select
                    id="categoryId"
                    {...register("categoryId")}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- {strings.common.all} {strings.products.category} --</option>
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="brandId">{strings.products.brand}</Label>
                  <select
                    id="brandId"
                    {...register("brandId")}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- {strings.products.brand} --</option>
                    {brands.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="taxClassId">{strings.products.taxClass}</Label>
                  <select
                    id="taxClassId"
                    {...register("taxClassId")}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- {strings.products.taxClass} --</option>
                    {taxClasses.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.rateBp / 100}%)</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reorderLevel">{strings.inventory.reorderLevel}</Label>
                  <Input
                    id="reorderLevel"
                    type="number"
                    min={0}
                    {...register("reorderLevel")}
                  />
                </div>
              </div>

              {/* Pricing Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label htmlFor="price">{strings.products.price} (BDT ৳) *</Label>
                  <Input
                    id="price"
                    type="number"
                    min={0}
                    step="0.01"
                    {...register("price")}
                    aria-invalid={!!errors.price}
                  />
                  {errors.price && (
                    <p className="text-xs text-destructive">{errors.price.message}</p>
                  )}
                </div>

                {canSeeCost && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cost">{strings.products.costPrice} (BDT ৳)</Label>
                    <Input
                      id="cost"
                      type="number"
                      min={0}
                      step="0.01"
                      {...register("cost")}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Size & Colour Options Builder */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">
                {strings.products.options}
              </CardTitle>
              <CardDescription className="text-xs">
                {locale === "bn"
                  ? "যেসব সাইজ এবং রঙে পণ্যটি তৈরি বা মজুদ আছে তা লিখুন"
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-bold"
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
                      className="h-7 w-20 text-xs uppercase"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddSize}
                      className="h-7 px-2 text-xs"
                    >
                      <Plus className="h-3 w-3 mr-0.5" /> যোগ
                    </Button>
                  </div>
                </div>
              </div>

              {/* Colours builder */}
              <div className="space-y-2 pt-2 border-t">
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
                      className="h-7 w-24 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddColor}
                      className="h-7 px-2 text-xs"
                    >
                      <Plus className="h-3 w-3 mr-0.5" /> যোগ
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Size & Colour Matrix Preview */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">
                {locale === "bn" ? "ভ্যারিয়েন্ট কম্বিনেশন গ্রিড" : "Variant Combinations Matrix"}
              </CardTitle>
              <CardDescription className="text-xs">
                {locale === "bn"
                  ? "যেসব সাইজ-রঙের সমন্বয় দোকানে থাকে তার টিকচিহ্ন দিন এবং মূল্য বসান"
                  : "Review combinations, set selling prices, and untick combinations not stocked"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SizeColorGrid
                sizes={sizes}
                colors={colors}
                matrix={matrix}
                onChange={handleMatrixChange}
                onToggleCell={handleToggleCell}
                mode="price"
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href="/catalog/products">
              <Button type="button" variant="outline">
                {strings.common.cancel}
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting} className="px-6">
              {isSubmitting ? strings.common.loading : strings.products.createProduct}
            </Button>
          </div>
        </form>
      </div>
    </PermissionGate>
  );
}
