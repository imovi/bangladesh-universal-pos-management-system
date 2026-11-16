"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Printer,
  PackageCheck,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface GoodsReceiptItem {
  id: string;
  variantId: string;
  qtyReceived: number;
  unitCostMinor: number;
  totalMinor: number;
  variant?: {
    id: string;
    sku: string;
    product?: {
      name: string;
    };
    optionValues?: any[];
    variantOptionValues?: any[];
  };
}

interface GoodsReceiptDetail {
  id: string;
  grnNumber: string;
  receivedAt: string;
  totalCostMinor: number;
  notes?: string | null;
  createdAt: string;
  supplier?: {
    id: string;
    name: string;
    contactName?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
  } | null;
  purchaseOrder?: {
    id: string;
    poNumber: string;
  } | null;
  items: GoodsReceiptItem[];
}

export default function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const grnId = resolvedParams.id;

  const { apiFetch } = useAuth();
  const { strings } = useTranslation();

  const [grn, setGrn] = useState<GoodsReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchGrnDetail = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/goods-receipts/${grnId}`);
      if (res.ok) {
        const json = await res.json();
        setGrn(json.data);
      } else {
        setErrorMessage("চালান খুঁজে পাওয়া যায়নি");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load goods receipt");
    } finally {
      setLoading(false);
    }
  }, [grnId]);

  useEffect(() => {
    fetchGrnDetail();
  }, [fetchGrnDetail]);

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        চালানের তথ্য লোড হচ্ছে...
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="p-8 text-center text-destructive">
        {errorMessage || "চালান পাওয়া যায়নি"}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto print:p-0 print:max-w-none">
      {/* Top Controls Bar (Hidden in Print) */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/receipts">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono" data-testid="grn-detail-number">
                {grn.grnNumber}
              </h1>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                <PackageCheck className="h-3.5 w-3.5" />
                <span>মজুদ গৃহীত</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              গ্রহণের তারিখ: {new Date(grn.receivedAt).toLocaleDateString("bn-BD")}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => window.print()}
          data-testid="btn-print-grn"
          className="flex items-center gap-1.5 h-9"
        >
          <Printer className="h-4 w-4" />
          <span>{strings.purchasing.print}</span>
        </Button>
      </div>

      {/* Printable Sheet View */}
      <div className="rounded-xl border border-border bg-card p-6 md:p-8 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0">
        {/* Printable Header */}
        <div className="border-b border-border pb-6 flex justify-between items-start">
          <div>
            <div className="text-xl font-bold uppercase tracking-wider text-primary">
              Universal POS
            </div>
            <h2 className="text-2xl font-bold text-foreground mt-1">
              পণ্য গ্রহণ চালান (Goods Receipt Note)
            </h2>
            <div className="font-mono text-sm text-muted-foreground mt-1">
              জিআরএন নং: <span className="font-bold text-foreground">{grn.grnNumber}</span>
            </div>
          </div>

          <div className="text-right space-y-1 text-xs text-muted-foreground">
            <div>
              গ্রহণের তারিখ:{" "}
              <span className="font-semibold text-foreground">
                {new Date(grn.receivedAt).toLocaleDateString("bn-BD")}
              </span>
            </div>
            {grn.purchaseOrder && (
              <div>
                ক্রয় আদেশ (PO):{" "}
                <Link
                  href={`/purchasing/orders/${grn.purchaseOrder.id}`}
                  className="font-mono font-semibold text-primary hover:underline"
                >
                  {grn.purchaseOrder.poNumber}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Vendor and Branch Info Grid */}
        <div className="grid grid-cols-2 gap-6 text-sm">
          {/* Supplier Info */}
          <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              সরবরাহকারী (Supplier)
            </span>
            <div className="font-bold text-foreground text-base">
              {grn.supplier?.name || "—"}
            </div>
            {grn.supplier?.contactName && (
              <div className="text-xs text-muted-foreground">
                যোগাযোগ: {grn.supplier.contactName}
              </div>
            )}
            {grn.supplier?.phone && (
              <div className="text-xs text-muted-foreground">
                ফোন: {grn.supplier.phone}
              </div>
            )}
            {grn.supplier?.address && (
              <div className="text-xs text-muted-foreground">
                ঠিকানা: {grn.supplier.address}
              </div>
            )}
          </div>

          {/* Delivery Branch Info */}
          <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              গ্রহণের শাখা (Receiving Branch)
            </span>
            <div className="font-bold text-foreground text-base">
              {grn.branch?.code} - {grn.branch?.name}
            </div>
            {grn.branch?.address && (
              <div className="text-xs text-muted-foreground">
                {grn.branch.address}
              </div>
            )}
            {grn.notes && (
              <div className="text-xs text-muted-foreground pt-1">
                নোট: {grn.notes}
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-left text-sm" data-testid="grn-detail-items-table">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
              <tr>
                <th className="px-4 py-3">ক্রমিক</th>
                <th className="px-4 py-3">গৃহীত পণ্য বিবরণ</th>
                <th className="px-4 py-3 text-center">গৃহীত সংখ্যা</th>
                <th className="px-4 py-3 text-right">একক ক্রয়মূল্য</th>
                <th className="px-4 py-3 text-right">মোট মূল্য</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grn.items.map((item, idx) => {
                const optValues = item.variant?.optionValues || [];
                const optionLabel = optValues
                  .map((ov: any) => ov.value || ov.optionValue?.value)
                  .join(" / ");

                return (
                  <tr key={item.id} data-testid="grn-item-row" className="hover:bg-muted/10">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {item.variant?.product?.name || "Product"}
                        {optionLabel ? ` (${optionLabel})` : ""}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        SKU: {item.variant?.sku}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400" data-testid="grn-item-qty">
                      {item.qtyReceived}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatMoney(item.unitCostMinor)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatMoney(item.totalMinor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* GRN Summary & Signatures */}
        <div className="flex flex-col sm:flex-row justify-between items-end gap-6 pt-4">
          <div className="hidden print:flex gap-16 pt-12 text-xs text-muted-foreground">
            <div className="border-t border-border pt-2 w-36 text-center">
              গ্রহণকারীর স্বাক্ষর (Store Keeper)
            </div>
            <div className="border-t border-border pt-2 w-36 text-center">
              যাচাইকারীর স্বাক্ষর (Manager)
            </div>
          </div>

          <div className="w-full sm:w-64 space-y-2 text-right">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">গৃহীত মোট আইটেম:</span>
              <span className="font-mono font-bold">{grn.items.length} টি</span>
            </div>
            <div className="flex justify-between text-base border-t border-border pt-2">
              <span className="font-semibold text-foreground">চালানের মোট মূল্য:</span>
              <span className="font-mono text-lg font-bold text-foreground" data-testid="grn-total-amount">
                {formatMoney(grn.totalCostMinor)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
