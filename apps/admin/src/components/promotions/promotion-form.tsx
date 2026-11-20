"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Calculator, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface PromotionFormProps {
  initialData?: any;
  isEdit?: boolean;
}

export function PromotionForm({ initialData, isEdit }: PromotionFormProps) {
  const router = useRouter();
  const { strings } = useTranslation();
  const { apiFetch } = useAuth();

  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [type, setType] = useState<string>(initialData?.type || "PERCENT_OFF");
  const [priority, setPriority] = useState<number>(initialData?.priority ?? 0);
  const [stackableWithBill, setStackableWithBill] = useState<boolean>(initialData?.stackableWithBill ?? true);
  const [startDate, setStartDate] = useState(initialData?.startDate ? initialData.startDate.slice(0, 10) : "");
  const [startTime, setStartTime] = useState(initialData?.startDate ? initialData.startDate.slice(11, 16) : "00:00");
  const [endDate, setEndDate] = useState(initialData?.endDate ? initialData.endDate.slice(0, 10) : "");
  const [endTime, setEndTime] = useState(initialData?.endDate ? initialData.endDate.slice(11, 16) : "23:59");

  // Config fields
  const [percent, setPercent] = useState<string>(
    initialData?.config?.percentBp ? (initialData.config.percentBp / 100).toString() : "10"
  );
  const [amount, setAmount] = useState<string>(
    initialData?.config?.amountMinor ? (Number(initialData.config.amountMinor) / 100).toString() : ""
  );
  const [fixedPrice, setFixedPrice] = useState<string>(
    initialData?.config?.fixedPriceMinor ? (Number(initialData.config.fixedPriceMinor) / 100).toString() : ""
  );
  const [cap, setCap] = useState<string>(
    initialData?.config?.maxDiscountMinor ? (Number(initialData.config.maxDiscountMinor) / 100).toString() : ""
  );
  const [buyQty, setBuyQty] = useState<string>(initialData?.config?.buyQty?.toString() || "2");
  const [getQty, setGetQty] = useState<string>(initialData?.config?.getQty?.toString() || "1");
  const [getDiscountPercent, setGetDiscountPercent] = useState<string>(
    initialData?.config?.getDiscountPercentBp !== undefined
      ? (initialData.config.getDiscountPercentBp / 100).toString()
      : "100"
  );
  const [bundleQty, setBundleQty] = useState<string>(initialData?.config?.bundleQty?.toString() || "3");
  const [bundlePrice, setBundlePrice] = useState<string>(
    initialData?.config?.bundlePriceMinor ? (Number(initialData.config.bundlePriceMinor) / 100).toString() : ""
  );
  const [threshold, setThreshold] = useState<string>(
    initialData?.config?.thresholdMinor ? (Number(initialData.config.thresholdMinor) / 100).toString() : "5000"
  );
  const [billDiscountType, setBillDiscountType] = useState<"PERCENT" | "AMOUNT">(
    initialData?.config?.discountType || "PERCENT"
  );

  // Targets & Conditions
  const [targetType, setTargetType] = useState<string>(initialData?.targets?.targetType || "ALL");
  const [targetIds, setTargetIds] = useState<string[]>(initialData?.targets?.targetIds || []);
  const [membersOnly, setMembersOnly] = useState<boolean>(Boolean(initialData?.conditions?.membersOnly));
  const [minQuantity, setMinQuantity] = useState<string>(initialData?.conditions?.minQuantity?.toString() || "");
  const [usageLimitTotal, setUsageLimitTotal] = useState<string>(initialData?.conditions?.usageLimitTotal?.toString() || "");
  const [usageLimitPerCustomer, setUsageLimitPerCustomer] = useState<string>(initialData?.conditions?.usageLimitPerCustomer?.toString() || "");

  const [formError, setFormError] = useState<string | null>(null);

  // Preview State
  const [previewLines, setPreviewLines] = useState<Array<{ variantId: string; productId: string; unitPrice: number; quantity: number }>>([]);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Catalog items for selector
  const { data: productsData } = useQuery({
    queryKey: ["products-for-promotions"],
    queryFn: async () => {
      const res = await apiFetch("/products?limit=100");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["categories-for-promotions"],
    queryFn: async () => {
      const res = await apiFetch("/categories");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const products = productsData || [];
  const categories = categoriesData || [];

  const buildConfig = () => {
    switch (type) {
      case "PERCENT_OFF":
        return {
          percentBp: Math.round(parseFloat(percent || "0") * 100),
          ...(cap ? { maxDiscountMinor: Math.round(parseFloat(cap) * 100) } : {}),
        };
      case "AMOUNT_OFF":
        return {
          amountMinor: Math.round(parseFloat(amount || "0") * 100),
        };
      case "FIXED_PRICE":
        return {
          fixedPriceMinor: Math.round(parseFloat(fixedPrice || "0") * 100),
        };
      case "BUY_X_GET_Y":
        return {
          buyQty: parseInt(buyQty || "1", 10),
          getQty: parseInt(getQty || "1", 10),
          getDiscountPercentBp: Math.round(parseFloat(getDiscountPercent || "100") * 100),
        };
      case "BUNDLE_PRICE":
        return {
          bundleQty: parseInt(bundleQty || "1", 10),
          bundlePriceMinor: Math.round(parseFloat(bundlePrice || "0") * 100),
        };
      case "BILL_THRESHOLD":
        return {
          thresholdMinor: Math.round(parseFloat(threshold || "0") * 100),
          discountType: billDiscountType,
          ...(billDiscountType === "PERCENT"
            ? {
                percentBp: Math.round(parseFloat(percent || "0") * 100),
                ...(cap ? { maxDiscountMinor: Math.round(parseFloat(cap) * 100) } : {}),
              }
            : {
                amountMinor: Math.round(parseFloat(amount || "0") * 100),
              }),
        };
      default:
        return {};
    }
  };

  const handleRunPreview = async () => {
    if (previewLines.length === 0) return;
    setPreviewLoading(true);
    setFormError(null);
    try {
      const config = buildConfig();
      const payload = {
        promotion: {
          id: initialData?.id || "preview-id",
          name: name || "Test Promo",
          type,
          status: "active",
          priority,
          stackableWithBill,
          startDate: startDate ? `${startDate}T${startTime}:00+06:00` : null,
          endDate: endDate ? `${endDate}T${endTime}:00+06:00` : null,
          config,
          targets: { targetType, targetIds },
          conditions: {
            membersOnly,
            minQuantity: minQuantity ? parseInt(minQuantity, 10) : undefined,
          },
        },
        lines: previewLines.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          unitPriceMinor: Math.round(l.unitPrice * 100),
          quantity: l.quantity,
          taxRateBp: 0,
        })),
        evaluationTime: new Date().toISOString(),
      };

      const res = await apiFetch("/promotions/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Preview calculation failed");
      }
      const data = await res.json();
      setPreviewResult(data);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      const config = buildConfig();
      const payload: any = {
        name,
        description: description || undefined,
        type,
        priority: Number(priority) || 0,
        stackableWithBill,
        startDate: startDate ? `${startDate}T${startTime}:00+06:00` : null,
        endDate: endDate ? `${endDate}T${endTime}:00+06:00` : null,
        config,
        targets: { targetType, targetIds },
        conditions: {
          membersOnly,
          ...(minQuantity ? { minQuantity: parseInt(minQuantity, 10) } : {}),
          ...(usageLimitTotal ? { usageLimitTotal: parseInt(usageLimitTotal, 10) } : {}),
          ...(usageLimitPerCustomer ? { usageLimitPerCustomer: parseInt(usageLimitPerCustomer, 10) } : {}),
        },
      };

      const url = isEdit ? `/promotions/${initialData.id}` : "/promotions";
      const method = isEdit ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to save promotion");
      }
      return res.json();
    },
    onSuccess: () => {
      router.push("/promotions");
    },
    onError: (err: any) => {
      setFormError(err.message);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/promotions">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isEdit ? strings.promotions.editPromotion : strings.promotions.newPromotion}
            </h1>
            <p className="text-muted-foreground text-sm">{strings.promotions.subtitle}</p>
          </div>
        </div>
      </div>

      {formError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{strings.promotions.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="promo-name">{strings.promotions.name} *</Label>
                  <Input
                    id="promo-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="promo-type">{strings.promotions.type} *</Label>
                  <Select
                    value={type}
                    onValueChange={(val) => setType(val)}
                    disabled={isEdit && initialData?.totalUses > 0}
                  >
                    <SelectTrigger id="promo-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT_OFF">{strings.promotions.types.PERCENT_OFF}</SelectItem>
                      <SelectItem value="AMOUNT_OFF">{strings.promotions.types.AMOUNT_OFF}</SelectItem>
                      <SelectItem value="FIXED_PRICE">{strings.promotions.types.FIXED_PRICE}</SelectItem>
                      <SelectItem value="BUY_X_GET_Y">{strings.promotions.types.BUY_X_GET_Y}</SelectItem>
                      <SelectItem value="BUNDLE_PRICE">{strings.promotions.types.BUNDLE_PRICE}</SelectItem>
                      <SelectItem value="BILL_THRESHOLD">{strings.promotions.types.BILL_THRESHOLD}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="promo-desc">{strings.promotions.description}</Label>
                <Input
                  id="promo-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="promo-priority">{strings.promotions.priority}</Label>
                  <Input
                    id="promo-priority"
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value || "0", 10))}
                  />
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <input
                    type="checkbox"
                    id="stackable-bill"
                    checked={stackableWithBill}
                    onChange={(e) => setStackableWithBill(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="stackable-bill" className="cursor-pointer">
                    {strings.promotions.conditions.stackableWithBill}
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {strings.promotions.types[type as keyof typeof strings.promotions.types] || type}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {type === "PERCENT_OFF" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.percentBp} *</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      placeholder="e.g. 20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.capMinor}</Label>
                    <Input
                      type="number"
                      value={cap}
                      onChange={(e) => setCap(e.target.value)}
                      placeholder="e.g. 1000"
                    />
                  </div>
                </div>
              )}

              {type === "AMOUNT_OFF" && (
                <div className="space-y-2">
                  <Label>{strings.promotions.config.amountMinor} *</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 300"
                  />
                </div>
              )}

              {type === "FIXED_PRICE" && (
                <div className="space-y-2">
                  <Label>{strings.promotions.config.fixedPriceMinor} *</Label>
                  <Input
                    type="number"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    placeholder="e.g. 999"
                  />
                </div>
              )}

              {type === "BUY_X_GET_Y" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.buyQty} *</Label>
                    <Input
                      type="number"
                      min="1"
                      value={buyQty}
                      onChange={(e) => setBuyQty(e.target.value)}
                      placeholder="2"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.getQty} *</Label>
                    <Input
                      type="number"
                      min="1"
                      value={getQty}
                      onChange={(e) => setGetQty(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.getDiscountPercentBp} *</Label>
                    <Input
                      type="number"
                      value={getDiscountPercent}
                      onChange={(e) => setGetDiscountPercent(e.target.value)}
                      placeholder="100"
                    />
                  </div>
                </div>
              )}

              {type === "BUNDLE_PRICE" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.bundleQty} *</Label>
                    <Input
                      type="number"
                      min="2"
                      value={bundleQty}
                      onChange={(e) => setBundleQty(e.target.value)}
                      placeholder="3"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{strings.promotions.config.bundlePriceMinor} *</Label>
                    <Input
                      type="number"
                      value={bundlePrice}
                      onChange={(e) => setBundlePrice(e.target.value)}
                      placeholder="1500"
                    />
                  </div>
                </div>
              )}

              {type === "BILL_THRESHOLD" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{strings.promotions.config.thresholdMinor} *</Label>
                      <Input
                        type="number"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        placeholder="5000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{strings.promotions.config.billDiscountType}</Label>
                      <Select
                        value={billDiscountType}
                        onValueChange={(val: any) => setBillDiscountType(val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PERCENT">{strings.promotions.config.billPercent}</SelectItem>
                          <SelectItem value="AMOUNT">{strings.promotions.config.billAmount}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {billDiscountType === "PERCENT" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{strings.promotions.config.percentBp} *</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={percent}
                          onChange={(e) => setPercent(e.target.value)}
                          placeholder="10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{strings.promotions.config.capMinor}</Label>
                        <Input
                          type="number"
                          value={cap}
                          onChange={(e) => setCap(e.target.value)}
                          placeholder="1000"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>{strings.promotions.config.amountMinor} *</Label>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="500"
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{strings.promotions.targets.targetType}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{strings.promotions.targets.targetType}</Label>
                <Select
                  value={targetType}
                  onValueChange={(val) => {
                    setTargetType(val);
                    setTargetIds([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{strings.promotions.targets.ALL}</SelectItem>
                    <SelectItem value="PRODUCTS">{strings.promotions.targets.PRODUCTS}</SelectItem>
                    <SelectItem value="CATEGORIES">{strings.promotions.targets.CATEGORIES}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {targetType === "PRODUCTS" && (
                <div className="space-y-2">
                  <Label>{strings.promotions.targets.selectProducts}</Label>
                  <Select
                    onValueChange={(id) => {
                      if (id && !targetIds.includes(id)) setTargetIds([...targetIds, id]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={strings.promotions.targets.selectProducts} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {targetIds.map((id) => {
                      const prod = products.find((p: any) => p.id === id);
                      return (
                        <Badge key={id} variant="secondary" className="gap-1">
                          {prod?.name || id}
                          <button
                            type="button"
                            onClick={() => setTargetIds(targetIds.filter((x) => x !== id))}
                            className="ml-1 hover:text-destructive"
                          >
                            ×
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {targetType === "CATEGORIES" && (
                <div className="space-y-2">
                  <Label>{strings.promotions.targets.selectCategories}</Label>
                  <Select
                    onValueChange={(id) => {
                      if (id && !targetIds.includes(id)) setTargetIds([...targetIds, id]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={strings.promotions.targets.selectCategories} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {targetIds.map((id) => {
                      const cat = categories.find((c: any) => c.id === id);
                      return (
                        <Badge key={id} variant="secondary" className="gap-1">
                          {cat?.name || id}
                          <button
                            type="button"
                            onClick={() => setTargetIds(targetIds.filter((x) => x !== id))}
                            className="ml-1 hover:text-destructive"
                          >
                            ×
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{strings.promotions.conditions.timeWindowHeader}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{strings.promotions.conditions.startDate}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-28"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{strings.promotions.conditions.endDate}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-28"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="space-y-2">
                  <Label>{strings.promotions.conditions.minQuantity}</Label>
                  <Input
                    type="number"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{strings.promotions.conditions.usageLimitTotal}</Label>
                  <Input
                    type="number"
                    value={usageLimitTotal}
                    onChange={(e) => setUsageLimitTotal(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{strings.promotions.conditions.usageLimitPerCustomer}</Label>
                  <Input
                    type="number"
                    value={usageLimitPerCustomer}
                    onChange={(e) => setUsageLimitPerCustomer(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="members-only"
                  checked={membersOnly}
                  onChange={(e) => setMembersOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="members-only" className="cursor-pointer">
                  {strings.promotions.conditions.membersOnly}
                </Label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview Calculator Box */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader className="bg-muted/30 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                {strings.promotions.preview.title}
              </CardTitle>
              <CardDescription>{strings.promotions.preview.subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label className="text-xs">{strings.promotions.preview.selectTestProducts}</Label>
                <div className="flex gap-2">
                  <Select
                    onValueChange={(val) => {
                      if (!val || previewLines.length >= 5) return;
                      const prod = products.find((p: any) => p.id === val);
                      const defaultVar = prod?.variants?.[0];
                      const price = defaultVar?.priceMinor ? Number(defaultVar.priceMinor) / 100 : 1000;
                      setPreviewLines([
                        ...previewLines,
                        {
                          productId: prod.id,
                          variantId: defaultVar?.id || `${prod.id}-v1`,
                          unitPrice: price,
                          quantity: 1,
                        },
                      ]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={strings.promotions.preview.addTestItem} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.slice(0, 30).map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                {previewLines.map((line, idx) => {
                  const prod = products.find((p: any) => p.id === line.productId);
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2 border rounded-md text-xs bg-card">
                      <div className="flex-1 truncate font-medium">
                        {prod?.name || `Item ${idx + 1}`}
                      </div>
                      <div className="w-16">
                        <Input
                          type="number"
                          className="h-7 text-xs"
                          value={line.unitPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const next = [...previewLines];
                            next[idx].unitPrice = val;
                            setPreviewLines(next);
                          }}
                        />
                      </div>
                      <div className="w-12">
                        <Input
                          type="number"
                          min="1"
                          className="h-7 text-xs"
                          value={line.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 1;
                            const next = [...previewLines];
                            next[idx].quantity = val;
                            setPreviewLines(next);
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setPreviewLines(previewLines.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
                {previewLines.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {strings.promotions.preview.noTestItems}
                  </p>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleRunPreview}
                disabled={previewLines.length === 0 || previewLoading}
              >
                <Calculator className="h-4 w-4" />
                {strings.promotions.preview.runTest}
              </Button>

              {previewResult && (
                <div className="p-3 bg-muted rounded-md space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{strings.promotions.preview.testGross}:</span>
                    <span>{formatMoney(Number(previewResult.grossMinor || 0))}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 font-medium">
                    <span>{strings.promotions.preview.testDiscount}:</span>
                    <span>-{formatMoney(Number(previewResult.totalPromotionDiscountMinor || 0))}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>{strings.promotions.preview.testNet}:</span>
                    <span>{formatMoney(Number(previewResult.netMinor || 0))}</span>
                  </div>
                  {previewResult.appliedPromotions?.length > 0 && (
                    <div className="pt-1 text-[11px] text-muted-foreground">
                      {previewResult.appliedPromotions.map((ap: any, i: number) => (
                        <div key={i} className="flex justify-between">
                          <span>{ap.name}:</span>
                          <span>{ap.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t space-y-2">
                <Button
                  className="w-full"
                  onClick={() => saveMutation.mutate()}
                  disabled={!name.trim() || saveMutation.isPending}
                >
                  {saveMutation.isPending ? strings.common.loading : strings.common.save}
                </Button>
                <Link href="/promotions" className="w-full block">
                  <Button variant="outline" className="w-full">
                    {strings.common.cancel}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
