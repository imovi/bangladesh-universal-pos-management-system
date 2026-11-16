"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Eye,
  FileCheck,
  Calendar,
  Building2,
  RefreshCw,
} from "lucide-react";
import { PermissionGate } from "@/components/common/permission-gate";
import { formatMoney } from "@/lib/utils";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  totalEstimatedMinor: number;
  expectedAt?: string | null;
  createdAt: string;
  supplier?: {
    id: string;
    name: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  items?: any[];
}

export default function PurchaseOrdersPage() {
  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);

      const res = await apiFetch(`/purchase-orders?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setOrders(items);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="outline" className="text-muted-foreground border-dashed">
            {strings.purchasing.statusDraft}
          </Badge>
        );
      case "ordered":
        return (
          <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            {strings.purchasing.statusOrdered}
          </Badge>
        );
      case "partially_received":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            {strings.purchasing.statusPartiallyReceived}
          </Badge>
        );
      case "received":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            {strings.purchasing.statusReceived}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
            {strings.purchasing.statusCancelled}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <PermissionGate permission="purchase.read">
      <div className="space-y-6">
      {/* Top Heading */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            ক্রয় আদেশ (Purchase Orders)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            সরবরাহকারী প্রতিষ্ঠানকে পাঠানো সমস্ত পণ্যের ক্রয় আদেশ তালিকা ও স্ট্যাটাস
          </p>
        </div>

        {hasPermission("purchase.manage") && (
          <Link href="/purchasing/orders/new">
            <Button data-testid="btn-create-po" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span>{strings.purchasing.createPO}</span>
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
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="পিও নম্বর দিয়ে খুঁজুন..."
            className="pl-9 h-10"
            data-testid="po-search-input"
          />
        </div>

        <select
          aria-label={strings.selectEmpty.allStatuses}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm w-full sm:w-auto"
          data-testid="po-status-filter"
        >
          <option value="all">সকল স্ট্যাটাস</option>
          <option value="draft">{strings.purchasing.statusDraft}</option>
          <option value="ordered">{strings.purchasing.statusOrdered}</option>
          <option value="partially_received">{strings.purchasing.statusPartiallyReceived}</option>
          <option value="received">{strings.purchasing.statusReceived}</option>
          <option value="cancelled">{strings.purchasing.statusCancelled}</option>
        </select>

        <Button
          variant="outline"
          size="icon"
          onClick={fetchOrders}
          title="রিফ্রেশ করুন"
          className="h-10 w-10 shrink-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="po-table">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
              <tr>
                <th className="px-6 py-3.5">পিও নম্বর ও তারিখ</th>
                <th className="px-6 py-3.5">সরবরাহকারী</th>
                <th className="px-6 py-3.5">শাখা</th>
                <th className="px-6 py-3.5 text-center">স্ট্যাটাস</th>
                <th className="px-6 py-3.5 text-right">আনুমানিক মোট মূল্য</th>
                <th className="px-6 py-3.5 text-right">কার্যক্রম</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    ক্রয় আদেশ লোড হচ্ছে...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    কোন ক্রয় আদেশ পাওয়া যায়নি
                  </td>
                </tr>
              ) : (
                orders.map((po) => (
                  <tr
                    key={po.id}
                    data-testid="po-row"
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <FileCheck className="h-4 w-4 text-primary shrink-0" />
                        <div>
                          <Link
                            href={`/purchasing/orders/${po.id}`}
                            className="font-mono font-bold text-foreground hover:underline"
                            data-testid="po-number-link"
                          >
                            {po.poNumber}
                          </Link>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Calendar className="h-3 w-3" />
                            <span>{new Date(po.createdAt).toLocaleDateString("bn-BD")}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="font-medium text-foreground block">
                        {po.supplier?.name || "—"}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{po.branch ? `${po.branch.code} - ${po.branch.name}` : "—"}</span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-center">
                      {getStatusBadge(po.status)}
                    </td>

                    <td className="px-6 py-4 text-right font-mono font-semibold">
                      {formatMoney(po.totalEstimatedMinor || 0)}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <Link href={`/purchasing/orders/${po.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="btn-view-po"
                          className="h-8 px-2 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          <span>বিস্তারিত</span>
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
  </PermissionGate>
);
}
