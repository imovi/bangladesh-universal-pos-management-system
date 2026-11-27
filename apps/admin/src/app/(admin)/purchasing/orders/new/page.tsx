"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, useModules } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Plus,
  Trash2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface ProductVariantOption {
  id: string;
  sku: string;
  priceMinor: number;
  costMinor: number;
  productName: string;
  optionLabel: string;
  baseUnit?: string;
  units?: Array<{ id: string; name: string; factor: number; isPurchaseUnit: boolean; isActive: boolean }>;
}

interface PoLineItem {
  variantId: string;
  variantLabel: string;
  qtyOrdered: number;
  unitCostTaka: string;
  productUnitId?: string;
  unitName?: string;
  unitFactor?: number;
  baseUnit?: string;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const { apiFetch, user } = useAuth();
  const { strings, locale } = useTranslation();
  const { isModuleActive } = useModules();
  const isUnitsActive = isModuleActive("units");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [availableVariants, setAvailableVariants] = useState<ProductVariantOption[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<PoLineItem[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [selectedQty, setSelectedQty] = useState("10");
  const [selectedCost, setSelectedCost] = useState("500");

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // 1. Fetch suppliers
        const sRes = await apiFetch("/suppliers?limit=100");
        if (sRes.ok) {
          const sJson = await sRes.json();
          const items = Array.isArray(sJson.data) ? sJson.data : (sJson.data?.items || []);
          setSuppliers(items);
          if (items.length > 0) setSupplierId(items[0].id);
        }

        // 2. Set branches from user or fetch
        if (user?.branches && user.branches.length > 0) {
          setBranches(user.branches);
          setBranchId(user.branches[0].id);
        } else {
          const bRes = await apiFetch("/branches");
          if (bRes.ok) {
            const bJson = await bRes.json();
            const bItems = Array.isArray(bJson.data) ? bJson.data : (bJson.data?.items || []);
            setBranches(bItems);
            if (bItems.length > 0) setBranchId(bItems[0].id);
          }
        }

        // 3. Fetch products & variants for line item builder
        const pRes = await apiFetch("/products?limit=100");
        if (pRes.ok) {
          const pJson = await pRes.json();
          const pItems = pJson.data || [];

          const variantList: ProductVariantOption[] = [];
          for (const prod of pItems) {
            if (prod.variants && Array.isArray(prod.variants)) {
              for (const v of prod.variants) {
                const optValues = v.optionValues || [];
                const optionLabel = optValues.map((ov: any) => ov.optionValue?.value || ov.value).join(" / ");
                variantList.push({
                  id: v.id,
                  sku: v.sku,
                  priceMinor: Number(v.priceMinor || 0),
                  costMinor: Number(v.costMinor || 0),
                  productName: prod.name,
                  optionLabel: optionLabel ? `${prod.name} (${optionLabel})` : prod.name,
                  baseUnit: prod.baseUnit || "pcs",
                  units: prod.units || [],
                });
              }
            }
          }
          setAvailableVariants(variantList);
          if (variantList.length > 0) {
            setSelectedVariantId(variantList[0].id);
            setSelectedCost((variantList[0].costMinor / 100).toString());
          }
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load purchasing dependencies");
      }
    }
    loadData();
  }, [user]);

  // When selected variant changes, pre-fill its current cost and reset unit
  const handleVariantSelectChange = (id: string) => {
    setSelectedVariantId(id);
    setSelectedUnitId("");
    const v = availableVariants.find((x) => x.id === id);
    if (v && v.costMinor > 0) {
      setSelectedCost((v.costMinor / 100).toString());
    }
  };

  // Add line item
  const handleAddLine = () => {
    if (!selectedVariantId) return;
    const variant = availableVariants.find((v) => v.id === selectedVariantId);
    if (!variant) return;

    const qty = parseFloat(selectedQty);
    if (isNaN(qty) || qty <= 0) return;

    const unit = variant.units?.find((u) => u.id === selectedUnitId);
    const unitName = unit ? unit.name : (variant.baseUnit || "pcs");
    const unitFactor = unit ? Number(unit.factor) : 1;

    // Check if already in lines with same variant and unit
    const existingIndex = lines.findIndex(
      (l) => l.variantId === selectedVariantId && l.productUnitId === (selectedUnitId || undefined),
    );
    if (existingIndex >= 0) {
      const updated = [...lines];
      updated[existingIndex].qtyOrdered += qty;
      updated[existingIndex].unitCostTaka = selectedCost;
      setLines(updated);
    } else {
      setLines([
        ...lines,
        {
          variantId: variant.id,
          variantLabel: `${variant.sku} — ${variant.optionLabel}`,
          qtyOrdered: qty,
          unitCostTaka: selectedCost,
          productUnitId: selectedUnitId || undefined,
          unitName,
          unitFactor,
          baseUnit: variant.baseUnit || "pcs",
        },
      ]);
    }
  };

  const handleRemoveLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  // Total estimated calculation
  const totalEstimatedPoisha = lines.reduce((acc, l) => {
    const costPoisha = Math.round(Number(l.unitCostTaka) * 100) || 0;
    return acc + l.qtyOrdered * costPoisha;
  }, 0);

  // Submit Purchase Order
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !branchId || lines.length === 0) {
      setErrorMessage("দয়া করে সরবরাহকারী, শাখা এবং কমপক্ষে একটি পণ্য যোগ করুন");
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);

      const items = lines.map((l) => ({
        variantId: l.variantId,
        qtyOrdered: l.qtyOrdered,
        unitCostMinor: Math.round(Number(l.unitCostTaka) * 100),
        productUnitId: l.productUnitId || undefined,
      }));

      const payload = {
        supplierId,
        branchId,
        expectedAt: expectedAt ? new Date(expectedAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
        items,
      };

      const res = await apiFetch("/purchase-orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to create purchase order");
      }

      const json = await res.json();
      const poId = json.data?.id;
      if (poId) {
        router.push(`/purchasing/orders/${poId}`);
      } else {
        router.push("/purchasing/orders");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Error creating purchase order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back button & Title */}
      <div className="flex items-center gap-3">
        <Link href="/purchasing/orders">
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.purchasing.createPO}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {locale === "bn"
              ? "সরবরাহকারীকে নতুন পণ্য সংগ্রহের চাহিদা বা অর্ডার তৈরি করুন"
              : "Create a new purchase order for supplier procurement"}
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          data-testid="error-alert"
          role="alert"
          className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* PO Basic Info Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span>{locale === "bn" ? "অর্ডারের সাধারণ তথ্য" : "General Information"}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Supplier Selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.supplierName} *
              </label>
              <select
                id="po-supplier-select"
                data-testid="po-supplier-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">{locale === "bn" ? "সরবরাহকারী নির্বাচন করুন" : "Select supplier"}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {locale === "bn" ? "গ্রহণের শাখা *" : "Destination Branch *"}
              </label>
              <select
                id="po-branch-select"
                data-testid="po-branch-select"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">{locale === "bn" ? "শাখা নির্বাচন করুন" : "Select branch"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} - {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Expected Delivery Date */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.expectedDate}
              </label>
              <Input
                type="date"
                id="po-expected-date"
                data-testid="po-expected-date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.notes}
              </label>
              <Input
                id="po-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="যেমন: জরুরি ভিত্তিতে সরবরাহ প্রয়োজন"
              />
            </div>
          </div>
        </div>

        {/* Line Items Builder Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center justify-between">
            <span>{locale === "bn" ? "অর্ডারের পণ্যসমূহ" : "Order Line Items"}</span>
            <span className="text-xs text-muted-foreground">
              {lines.length} {locale === "bn" ? "টি পণ্য যুক্ত হয়েছে" : "items added"}
            </span>
          </h2>

          {/* Add Line Inputs */}
          <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className={isUnitsActive ? "sm:col-span-4" : "sm:col-span-6"}>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {locale === "bn" ? "পণ্য / ভ্যারিয়েন্ট নির্বাচন করুন" : "Select Product / Variant"}
                </label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => handleVariantSelectChange(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  data-testid="po-item-variant-select"
                >
                  {availableVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku} — {v.optionLabel}
                    </option>
                  ))}
                </select>
              </div>

              {isUnitsActive && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    {locale === "bn" ? "একক (Unit)" : "Unit"}
                  </label>
                  <select
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    className="w-full h-10 px-2 rounded-md border border-input bg-background text-sm"
                    data-testid="po-item-unit-select"
                  >
                    <option value="">
                      {availableVariants.find((v) => v.id === selectedVariantId)?.baseUnit || "pcs"}
                    </option>
                    {(availableVariants.find((v) => v.id === selectedVariantId)?.units || [])
                      .filter((u) => u.isActive && u.isPurchaseUnit)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} (×{u.factor})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {strings.purchasing.orderedQty}
                </label>
                <Input
                  type="number"
                  min="0.001"
                  step="any"
                  value={selectedQty}
                  onChange={(e) => setSelectedQty(e.target.value)}
                  data-testid="po-item-qty-input"
                  className="h-10"
                />
                {isUnitsActive && selectedUnitId && (
                  <span className="text-[11px] text-primary font-medium block mt-1">
                    = {Number(selectedQty || 0) * Number(availableVariants.find((v) => v.id === selectedVariantId)?.units?.find((u) => u.id === selectedUnitId)?.factor || 1)} {availableVariants.find((v) => v.id === selectedVariantId)?.baseUnit || "pcs"}
                  </span>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {strings.purchasing.unitCost} (৳)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={selectedCost}
                  onChange={(e) => setSelectedCost(e.target.value)}
                  data-testid="po-item-cost-input"
                  className="h-10"
                />
              </div>

              <div className="sm:col-span-2">
                <Button
                  type="button"
                  onClick={handleAddLine}
                  data-testid="btn-add-po-line"
                  className="w-full h-10 flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span>{locale === "bn" ? "যোগ করুন" : "Add"}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-left text-sm" data-testid="po-items-table">
              <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
                <tr>
                  <th className="px-4 py-3">{locale === "bn" ? "পণ্য বিবরণ" : "Product Details"}</th>
                  <th className="px-4 py-3 text-center">{locale === "bn" ? "পরিমাণ" : "Quantity"}</th>
                  <th className="px-4 py-3 text-right">{locale === "bn" ? "একক মূল্য" : "Unit Cost"}</th>
                  <th className="px-4 py-3 text-right">{locale === "bn" ? "মোট মূল্য" : "Total"}</th>
                  <th className="px-4 py-3 text-center w-12">{locale === "bn" ? "মুছুন" : "Remove"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">
                      {locale === "bn"
                        ? "এখনো কোনো পণ্য যুক্ত করা হয়নি। উপরের ফর্ম থেকে পণ্য যুক্ত করুন।"
                        : "No items added yet. Use the inputs above to add items."}
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => {
                    const lineTotalPoisha = line.qtyOrdered * Math.round(Number(line.unitCostTaka) * 100);
                    return (
                      <tr key={idx} data-testid="po-line-row" className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {line.variantLabel}
                        </td>
                        <td className="px-4 py-3 text-center font-mono">
                          <span className="font-bold">{line.qtyOrdered} {line.unitName || "pcs"}</span>
                          {line.unitFactor && line.unitFactor !== 1 && (
                            <span className="text-[11px] text-muted-foreground block">
                              = {line.qtyOrdered * line.unitFactor} {line.baseUnit || "pcs"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          ৳ {Number(line.unitCostTaka).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {formatMoney(lineTotalPoisha)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveLine(idx)}
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Grand Total Summary */}
          {lines.length > 0 && (
            <div className="flex justify-end pt-2">
              <div className="text-right space-y-1">
                <span className="text-xs text-muted-foreground block">
                  {strings.purchasing.totalAmount} (আনুমানিক)
                </span>
                <span
                  className="font-mono text-xl font-bold text-foreground block"
                  data-testid="po-grand-total"
                >
                  {formatMoney(totalEstimatedPoisha)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="flex justify-end gap-3 pt-4">
          <Link href="/purchasing/orders">
            <Button type="button" variant="outline" disabled={saving}>
              বাতিল
            </Button>
          </Link>
          <Button
            type="submit"
            data-testid="btn-save-po"
            disabled={saving || lines.length === 0}
            className="px-6"
          >
            {saving ? "অর্ডার তৈরি হচ্ছে..." : "ক্রয় আদেশ নিশ্চিত করুন"}
          </Button>
        </div>
      </form>
    </div>
  );
}
