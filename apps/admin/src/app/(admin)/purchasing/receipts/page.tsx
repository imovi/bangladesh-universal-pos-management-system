"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  Eye,
  PackageCheck,
  Calendar,
  Building2,
  RefreshCw,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface GoodsReceipt {
  id: string;
  grnNumber: string;
  receivedAt: string;
  totalCostMinor: number;
  purchaseOrderId?: string | null;
  supplier?: {
    id: string;
    name: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  purchaseOrder?: {
    id: string;
    poNumber: string;
  } | null;
  items?: any[];
}

export default function GoodsReceiptsPage() {
  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);

      const res = await apiFetch(`/goods-receipts?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setReceipts(items);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load goods receipts");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  return (
    <div className="space-y-6">
      {/* Top Heading */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            পণ্য গ্রহণ চালান (Goods Receipts / GRN)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            সরবরাহকারী বা ক্রয় আদেশের বিপরীতে শাখায় গৃহীত চালানের হিসাব ও মজুদ আপডেট
          </p>
        </div>

        {hasPermission("purchase.receive") && (
          <Link href="/purchasing/receipts/new">
            <Button data-testid="btn-create-grn" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span>{strings.purchasing.receiveGoods}</span>
            </Button>
          </Link>
        )}
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          data-testid="error-alert"
          role="alert"
          className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive flex justify-between items-center"
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

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="জিআরএন বা পিও নম্বর দিয়ে খুঁজুন..."
            className="pl-9 h-10"
            data-testid="grn-search-input"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={fetchReceipts}
          title="রিফ্রেশ করুন"
          className="h-10 w-10 shrink-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Receipts Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="grn-table">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
              <tr>
                <th className="px-6 py-3.5">জিআরএন নম্বর ও তারিখ</th>
                <th className="px-6 py-3.5">সরবরাহকারী</th>
                <th className="px-6 py-3.5">শাখা</th>
                <th className="px-6 py-3.5">ক্রয় আদেশ (PO)</th>
                <th className="px-6 py-3.5 text-right">গৃহীত মোট মূল্য</th>
                <th className="px-6 py-3.5 text-right">কার্যক্রম</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    চালান লোড হচ্ছে...
                  </td>
                </tr>
              ) : receipts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    কোন চালান (GRN) পাওয়া যায়নি
                  </td>
                </tr>
              ) : (
                receipts.map((grn) => (
                  <tr
                    key={grn.id}
                    data-testid="grn-row"
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <PackageCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div>
                          <Link
                            href={`/purchasing/receipts/${grn.id}`}
                            className="font-mono font-bold text-foreground hover:underline"
                            data-testid="grn-number-link"
                          >
                            {grn.grnNumber}
                          </Link>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Calendar className="h-3 w-3" />
                            <span>{new Date(grn.receivedAt).toLocaleDateString("bn-BD")}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="font-medium text-foreground block">
                        {grn.supplier?.name || "—"}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{grn.branch ? `${grn.branch.code} - ${grn.branch.name}` : "—"}</span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-xs">
                      {grn.purchaseOrder ? (
                        <Link
                          href={`/purchasing/orders/${grn.purchaseOrder.id}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {grn.purchaseOrder.poNumber}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">সরাসরি গ্রহণ (Direct)</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right font-mono font-semibold">
                      {formatMoney(grn.totalCostMinor || 0)}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <Link href={`/purchasing/receipts/${grn.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="btn-view-grn"
                          className="h-8 px-2 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          <span>রিসিপ্ট</span>
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
