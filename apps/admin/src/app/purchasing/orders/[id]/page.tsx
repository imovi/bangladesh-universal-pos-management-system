"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  PackageCheck,
  Send,
  XCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface PurchaseOrderItem {
  id: string;
  variantId: string;
  qtyOrdered: number;
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

interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  status: string;
  totalEstimatedMinor: number;
  expectedAt?: string | null;
  orderedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  supplier?: {
    id: string;
    name: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
  } | null;
  items: PurchaseOrderItem[];
}

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const poId = resolvedParams.id;

  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchOrderDetail = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/purchase-orders/${poId}`);
      if (res.ok) {
        const json = await res.json();
        setOrder(json.data);
      } else {
        setErrorMessage("ক্রয় আদেশ খুঁজে পাওয়া যায়নি");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    fetchOrderDetail();
  }, [fetchOrderDetail]);

  // Update Status
  const handleUpdateStatus = async (newStatus: string) => {
    try {
      setUpdating(true);
      setErrorMessage(null);

      const res = await apiFetch(`/purchase-orders/${poId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to update status");
      }

      setSuccessMessage(
        newStatus === "ordered"
          ? strings.purchasing.poStatusUpdated
          : strings.purchasing.poCancelled
      );
      fetchOrderDetail();
    } catch (err: any) {
      setErrorMessage(err.message || "Error updating order status");
    } finally {
      setUpdating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="outline" className="text-muted-foreground border-dashed text-xs">
            {strings.purchasing.statusDraft}
          </Badge>
        );
      case "ordered":
        return (
          <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs">
            {strings.purchasing.statusOrdered}
          </Badge>
        );
      case "partially_received":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs">
            {strings.purchasing.statusPartiallyReceived}
          </Badge>
        );
      case "received":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs">
            {strings.purchasing.statusReceived}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
            {strings.purchasing.statusCancelled}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        ক্রয় আদেশের তথ্য লোড হচ্ছে...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-8 text-center text-destructive">
        {errorMessage || "ক্রয় আদেশ পাওয়া যায়নি"}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto print:p-0 print:max-w-none">
      {/* Top Controls Bar (Hidden in Print) */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/orders">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono" data-testid="po-detail-number">
                {order.poNumber}
              </h1>
              <div data-testid="po-detail-status">{getStatusBadge(order.status)}</div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              তৈরি: {new Date(order.createdAt).toLocaleDateString("bn-BD")}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            data-testid="btn-print-po"
            className="flex items-center gap-1.5 h-9"
          >
            <Printer className="h-4 w-4" />
            <span>{strings.purchasing.print}</span>
          </Button>

          {/* If Draft, allow Mark as Ordered */}
          {order.status === "draft" && hasPermission("purchase.manage") && (
            <Button
              size="sm"
              onClick={() => handleUpdateStatus("ordered")}
              data-testid="btn-mark-ordered"
              disabled={updating}
              className="flex items-center gap-1.5 h-9"
            >
              <Send className="h-4 w-4" />
              <span>অর্ডার নিশ্চিত করুন (Send)</span>
            </Button>
          )}

          {/* If Ordered or Partially Received, allow Receive Goods */}
          {(order.status === "ordered" || order.status === "partially_received") &&
            hasPermission("purchase.receive") && (
              <Link href={`/purchasing/receipts/new?poId=${order.id}`}>
                <Button
                  size="sm"
                  data-testid="btn-receive-po"
                  className="flex items-center gap-1.5 h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <PackageCheck className="h-4 w-4" />
                  <span>{strings.purchasing.receiveGoods}</span>
                </Button>
              </Link>
            )}

          {/* If not cancelled or fully received, allow Cancel */}
          {order.status !== "cancelled" &&
            order.status !== "received" &&
            hasPermission("purchase.manage") && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleUpdateStatus("cancelled")}
                data-testid="btn-cancel-po"
                disabled={updating}
                className="flex items-center gap-1.5 h-9"
              >
                <XCircle className="h-4 w-4" />
                <span>{strings.purchasing.cancelPO}</span>
              </Button>
            )}
        </div>
      </div>

      {/* Success Alert */}
      {successMessage && (
        <div
          data-testid="success-alert"
          role="alert"
          className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-sm text-emerald-600 dark:text-emerald-400 flex justify-between items-center print:hidden"
        >
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs underline ml-4"
          >
            বন্ধ করুন
          </button>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div
          data-testid="error-alert"
          role="alert"
          className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive flex justify-between items-center print:hidden"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs underline ml-4"
          >
            বন্ধ করুন
          </button>
        </div>
      )}

      {/* Printable Sheet View */}
      <div className="rounded-xl border border-border bg-card p-6 md:p-8 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0">
        {/* Printable Header */}
        <div className="border-b border-border pb-6 flex justify-between items-start">
          <div>
            <div className="text-xl font-bold uppercase tracking-wider text-primary">
              Universal POS
            </div>
            <h2 className="text-2xl font-bold text-foreground mt-1">
              ক্রয় আদেশ (Purchase Order)
            </h2>
            <div className="font-mono text-sm text-muted-foreground mt-1">
              পিও নং: <span className="font-bold text-foreground">{order.poNumber}</span>
            </div>
          </div>

          <div className="text-right space-y-1 text-xs text-muted-foreground">
            <div>
              অর্ডারের তারিখ:{" "}
              <span className="font-semibold text-foreground">
                {new Date(order.createdAt).toLocaleDateString("bn-BD")}
              </span>
            </div>
            {order.expectedAt && (
              <div>
                সম্ভাব্য ডেলিভারি:{" "}
                <span className="font-semibold text-foreground">
                  {new Date(order.expectedAt).toLocaleDateString("bn-BD")}
                </span>
              </div>
            )}
            <div className="pt-1">
              স্ট্যাটাস: {getStatusBadge(order.status)}
            </div>
          </div>
        </div>

        {/* Vendor and Branch Info Grid */}
        <div className="grid grid-cols-2 gap-6 text-sm">
          {/* Supplier Info */}
          <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              সরবরাহকারী (Vendor / Supplier)
            </span>
            <div className="font-bold text-foreground text-base" data-testid="po-supplier-name">
              {order.supplier?.name}
            </div>
            {order.supplier?.contactName && (
              <div className="text-xs text-muted-foreground">
                যোগাযোগ: {order.supplier.contactName}
              </div>
            )}
            {order.supplier?.phone && (
              <div className="text-xs text-muted-foreground">
                ফোন: {order.supplier.phone}
              </div>
            )}
            {order.supplier?.address && (
              <div className="text-xs text-muted-foreground">
                ঠিকানা: {order.supplier.address}
              </div>
            )}
          </div>

          {/* Delivery Branch Info */}
          <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              পণ্য গ্রহণের স্থান (Delivery Location)
            </span>
            <div className="font-bold text-foreground text-base">
              {order.branch?.code} - {order.branch?.name}
            </div>
            {order.branch?.address && (
              <div className="text-xs text-muted-foreground">
                {order.branch.address}
              </div>
            )}
            {order.notes && (
              <div className="text-xs text-amber-700 dark:text-amber-400 pt-1">
                বিশেষ নোট: {order.notes}
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-left text-sm" data-testid="po-detail-items-table">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
              <tr>
                <th className="px-4 py-3">ক্রমিক</th>
                <th className="px-4 py-3">পণ্য ও ভ্যারিয়েন্ট বিবরণ</th>
                <th className="px-4 py-3 text-center">অর্ডার সংখ্যা</th>
                <th className="px-4 py-3 text-center">গৃহীত সংখ্যা</th>
                <th className="px-4 py-3 text-center">অবশিষ্ট</th>
                <th className="px-4 py-3 text-right">একক মূল্য</th>
                <th className="px-4 py-3 text-right">মোট মূল্য</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((item, idx) => {
                const optValues =
                  item.variant?.optionValues || item.variant?.variantOptionValues || [];
                const optionLabel = optValues
                  .map((ov: any) => ov.value || ov.optionValue?.value)
                  .join(" / ");
                const remaining = item.qtyOrdered - item.qtyReceived;

                return (
                  <tr key={item.id} data-testid="po-item-row" className="hover:bg-muted/10">
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
                    <td className="px-4 py-3 text-center font-mono font-bold" data-testid="item-qty-ordered">
                      {item.qtyOrdered}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-emerald-600 dark:text-emerald-400" data-testid="item-qty-received">
                      {item.qtyReceived}
                    </td>
                    <td
                      className={`px-4 py-3 text-center font-mono font-semibold ${
                        remaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                      }`}
                      data-testid="item-qty-remaining"
                    >
                      {remaining}
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

        {/* Order Summary & Signatures */}
        <div className="flex flex-col sm:flex-row justify-between items-end gap-6 pt-4">
          {/* Signatures for Print View */}
          <div className="hidden print:flex gap-16 pt-12 text-xs text-muted-foreground">
            <div className="border-t border-border pt-2 w-36 text-center">
              প্রস্তুতকারীর স্বাক্ষর
            </div>
            <div className="border-t border-border pt-2 w-36 text-center">
              অনুমোদনকারীর স্বাক্ষর
            </div>
          </div>

          <div className="w-full sm:w-64 space-y-2 text-right">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">সর্বমোট আইটেম:</span>
              <span className="font-mono font-bold">{order.items.length} টি</span>
            </div>
            <div className="flex justify-between text-base border-t border-border pt-2">
              <span className="font-semibold text-foreground">সর্বমোট মূল্য:</span>
              <span className="font-mono text-lg font-bold text-foreground" data-testid="po-total-amount">
                {formatMoney(order.totalEstimatedMinor)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
