"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Plus,
  Trash2,
  PackageCheck,
  AlertTriangle,
  Building2,
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
}

interface GrnLineItem {
  purchaseOrderItemId?: string;
  variantId: string;
  variantLabel: string;
  maxOrderedQty?: number;
  qtyReceived: number;
  unitCostTaka: string;
}

function NewGoodsReceiptContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const poIdParam = searchParams.get("poId");

  const { apiFetch, user } = useAuth();
  const { strings } = useTranslation();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [availableVariants, setAvailableVariants] = useState<ProductVariantOption[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(poIdParam);
  const [poNumber, setPoNumber] = useState<string | null>(null);
  const [grnNumber, setGrnNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<GrnLineItem[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedQty, setSelectedQty] = useState("5");
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
          if (items.length > 0 && !supplierId) setSupplierId(items[0].id);
        }

        // 2. Fetch branches
        if (user?.branches && user.branches.length > 0) {
          setBranches(user.branches);
          if (!branchId) setBranchId(user.branches[0].id);
        } else {
          const bRes = await apiFetch("/branches");
          if (bRes.ok) {
            const bJson = await bRes.json();
            const bItems = Array.isArray(bJson.data) ? bJson.data : (bJson.data?.items || []);
            setBranches(bItems);
            if (bItems.length > 0 && !branchId) setBranchId(bItems[0].id);
          }
        }

        // 3. Fetch variants
        const pRes = await apiFetch("/products?limit=100");
        if (pRes.ok) {
          const pJson = await pRes.json();
          const pItems = Array.isArray(pJson.data) ? pJson.data : (pJson.data?.items || []);

          const variantList: ProductVariantOption[] = [];
          for (const prod of pItems) {
            if (prod.variants && Array.isArray(prod.variants)) {
              for (const v of prod.variants) {
                const optValues = v.optionValues || v.variantOptionValues || [];
                const optionLabel = optValues.map((ov: any) => ov.value || ov.optionValue?.value).join(" / ");
                variantList.push({
                  id: v.id,
                  sku: v.sku,
                  priceMinor: Number(v.priceMinor || 0),
                  costMinor: Number(v.costMinor || 0),
                  productName: prod.name,
                  optionLabel: optionLabel ? `${prod.name} (${optionLabel})` : prod.name,
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

        // 4. If poIdParam provided, load PO and prefill lines with remaining quantities
        if (poIdParam) {
          const poRes = await apiFetch(`/purchase-orders/${poIdParam}`);
          if (poRes.ok) {
            const poJson = await poRes.json();
            const po = poJson.data;
            if (po) {
              setPurchaseOrderId(po.id);
              setPoNumber(po.poNumber);
              if (po.supplierId) setSupplierId(po.supplierId);
              if (po.branchId) setBranchId(po.branchId);

              const initialLines: GrnLineItem[] = (po.items || []).map((item: any) => {
                const optValues =
                  item.variant?.optionValues || item.variant?.variantOptionValues || [];
                const optionLabel = optValues
                  .map((ov: any) => ov.value || ov.optionValue?.value)
                  .join(" / ");
                const remaining = Math.max(0, item.qtyOrdered - item.qtyReceived);

                return {
                  purchaseOrderItemId: item.id,
                  variantId: item.variantId,
                  variantLabel: `${item.variant?.sku} — ${item.variant?.product?.name || "Product"} (${optionLabel})`,
                  maxOrderedQty: item.qtyOrdered,
                  qtyReceived: remaining > 0 ? remaining : item.qtyOrdered,
                  unitCostTaka: (Number(item.unitCostMinor) / 100).toFixed(2),
                };
              });
              setLines(initialLines);
            }
          }
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load dependencies");
      }
    }
    loadData();
  }, [poIdParam, user]);

  // Add line item manually
  const handleAddLine = () => {
    if (!selectedVariantId) return;
    const variant = availableVariants.find((v) => v.id === selectedVariantId);
    if (!variant) return;

    const qty = parseInt(selectedQty, 10);
    if (isNaN(qty) || qty <= 0) return;

    const existingIndex = lines.findIndex((l) => l.variantId === selectedVariantId);
    if (existingIndex >= 0) {
      const updated = [...lines];
      updated[existingIndex].qtyReceived += qty;
      updated[existingIndex].unitCostTaka = selectedCost;
      setLines(updated);
    } else {
      setLines([
        ...lines,
        {
          variantId: variant.id,
          variantLabel: `${variant.sku} — ${variant.optionLabel}`,
          qtyReceived: qty,
          unitCostTaka: selectedCost,
        },
      ]);
    }
  };

  const handleRemoveLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleQtyChange = (index: number, newQty: string) => {
    const val = parseInt(newQty, 10);
    const updated = [...lines];
    updated[index].qtyReceived = isNaN(val) ? 0 : val;
    setLines(updated);
  };

  const handleCostChange = (index: number, newCost: string) => {
    const updated = [...lines];
    updated[index].unitCostTaka = newCost;
    setLines(updated);
  };

  // Total GRN value
  const totalGrnPoisha = lines.reduce((acc, l) => {
    const costPoisha = Math.round(Number(l.unitCostTaka) * 100) || 0;
    return acc + l.qtyReceived * costPoisha;
  }, 0);

  // Submit Goods Receipt
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || lines.length === 0) {
      setErrorMessage("দয়া করে গ্রহণের শাখা এবং কমপক্ষে একটি পণ্য যোগ করুন");
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);

      const items = lines.map((l) => ({
        purchaseOrderItemId: l.purchaseOrderItemId || undefined,
        variantId: l.variantId,
        qtyReceived: l.qtyReceived,
        unitCostMinor: Math.round(Number(l.unitCostTaka) * 100),
      }));

      const payload = {
        supplierId: supplierId || undefined,
        purchaseOrderId: purchaseOrderId || undefined,
        branchId,
        grnNumber: grnNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        items,
      };

      const res = await apiFetch("/goods-receipts", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to create goods receipt");
      }

      const json = await res.json();
      const grnId = json.data?.id;
      if (grnId) {
        router.push(`/purchasing/receipts/${grnId}`);
      } else {
        router.push("/purchasing/receipts");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Error creating goods receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Title & Back */}
      <div className="flex items-center gap-3">
        <Link href="/purchasing/receipts">
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.purchasing.receiveGoods}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            সরবরাহকারী থেকে নতুন পণ্য চালান গ্রহণ ও মজুদে অন্তর্ভুক্তি
          </p>
        </div>
      </div>

      {/* Mandatory Weighted Average Cost Alert Notice */}
      <div
        data-testid="weighted-cost-notice"
        className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-3"
      >
        <PackageCheck className="h-5 w-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
        <div>
          <span className="font-semibold block">মজুদ ও ক্রয়মূল্য সমন্বয় নোটিশ:</span>
          <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
            {strings.purchasing.weightedCostNotice}
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
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* GRN Basic Info Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <span>চালানের সাধারণ তথ্য</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Purchase Order Indicator (if PO receipt) */}
            {poNumber && (
              <div className="sm:col-span-2 p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground block">
                    ক্রয় আদেশ রেফারেন্স
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {poNumber}
                  </span>
                </div>
                <Badge variant="outline" className="text-xs">
                  PO থেকে পূরণকৃত
                </Badge>
              </div>
            )}

            {/* Supplier Selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.supplierName}
              </label>
              <select
                id="grn-supplier-select"
                data-testid="grn-supplier-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">সরবরাহকারী নির্বাচন করুন</option>
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
                গ্রহণের শাখা *
              </label>
              <select
                id="grn-branch-select"
                data-testid="grn-branch-select"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">শাখা নির্বাচন করুন</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} - {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom GRN Number */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.grnNumber} (ঐচ্ছিক)
              </label>
              <Input
                id="grn-number"
                data-testid="grn-number-input"
                value={grnNumber}
                onChange={(e) => setGrnNumber(e.target.value)}
                placeholder="খালি রাখলে স্বয়ংক্রিয় তৈরি হবে"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.notes}
              </label>
              <Input
                id="grn-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="যেমন: চালান নং CH-8891 এর মাধ্যমে গৃহীত"
              />
            </div>
          </div>
        </div>

        {/* Goods Line Items Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              গৃহীত পণ্যসমূহ (Received Items)
            </h2>
            <span className="text-xs text-muted-foreground">
              {lines.length} টি পণ্য
            </span>
          </div>

          {/* Add Line if direct receipt */}
          {!poIdParam && (
            <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-6">
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    পণ্য / ভ্যারিয়েন্ট নির্বাচন
                  </label>
                  <select
                    value={selectedVariantId}
                    onChange={(e) => setSelectedVariantId(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    {availableVariants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} — {v.optionLabel}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    {strings.purchasing.receivedQty}
                  </label>
                  <Input
                    type="number"
                    min="1"
                    value={selectedQty}
                    onChange={(e) => setSelectedQty(e.target.value)}
                    className="h-10"
                  />
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
                    className="h-10"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    onClick={handleAddLine}
                    className="w-full h-10 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    <span>যোগ করুন</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Received Items Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-left text-sm" data-testid="grn-items-table">
              <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
                <tr>
                  <th className="px-4 py-3">পণ্য বিবরণ</th>
                  <th className="px-4 py-3 text-center w-32">
                    {strings.purchasing.receivedQty}
                  </th>
                  <th className="px-4 py-3 text-right w-36">
                    {strings.purchasing.unitCost} (৳)
                  </th>
                  <th className="px-4 py-3 text-right">মোট মূল্য</th>
                  {!poIdParam && <th className="px-4 py-3 text-center w-12">মুছুন</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">
                      এখনো কোনো পণ্য গ্রহণ করা হয়নি।
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => {
                    const lineTotalPoisha =
                      line.qtyReceived * Math.round(Number(line.unitCostTaka) * 100);

                    return (
                      <tr key={idx} data-testid="grn-line-row" className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {line.variantLabel}
                          {line.maxOrderedQty !== undefined && (
                            <span className="block text-xs text-muted-foreground">
                              অর্ডারকৃত ছিল: {line.maxOrderedQty} টি
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-center">
                          <Input
                            type="number"
                            min="1"
                            value={line.qtyReceived}
                            onChange={(e) => handleQtyChange(idx, e.target.value)}
                            data-testid={`grn-qty-input-${idx}`}
                            className="h-9 text-center font-mono font-bold"
                          />
                        </td>

                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.unitCostTaka}
                            onChange={(e) => handleCostChange(idx, e.target.value)}
                            data-testid={`grn-cost-input-${idx}`}
                            className="h-9 text-right font-mono"
                          />
                        </td>

                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {formatMoney(lineTotalPoisha)}
                        </td>

                        {!poIdParam && (
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
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Grand Total */}
          {lines.length > 0 && (
            <div className="flex justify-end pt-2">
              <div className="text-right space-y-1">
                <span className="text-xs text-muted-foreground block">
                  মোট চালান মূল্য (GRN Total)
                </span>
                <span
                  className="font-mono text-xl font-bold text-foreground block"
                  data-testid="grn-grand-total"
                >
                  {formatMoney(totalGrnPoisha)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="flex justify-end gap-3 pt-4">
          <Link href="/purchasing/receipts">
            <Button type="button" variant="outline" disabled={saving}>
              বাতিল
            </Button>
          </Link>
          <Button
            type="submit"
            data-testid="btn-save-grn"
            disabled={saving || lines.length === 0}
            className="px-6 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? "সংরক্ষণ হচ্ছে..." : "পণ্য গ্রহণ সম্পন্ন করুন"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewGoodsReceiptPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">লোড হচ্ছে...</div>}>
      <NewGoodsReceiptContent />
    </Suspense>
  );
}
