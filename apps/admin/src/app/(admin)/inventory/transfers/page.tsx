"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, ArrowRight, Search, Truck, CheckCircle2, Clock, XCircle, FileText } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function StockTransfersPage() {
  const { hasPermission, apiFetch } = useAuth();
  const { locale } = useTranslation();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // Fetch branches for filter
  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: async () => {
      const res = await apiFetch("/branches");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  // Fetch transfers list
  const { data: transferData, isLoading } = useQuery({
    queryKey: ["stock-transfers", statusFilter, searchTerm, selectedBranchId, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchTerm) params.set("search", searchTerm);
      if (selectedBranchId) params.set("branchId", selectedBranchId);
      params.set("page", String(page));
      params.set("limit", String(pageSize));

      const res = await apiFetch(`/inventory/transfers?${params.toString()}`);
      if (!res.ok) return { items: [], pagination: { total: 0, totalPages: 1 } };
      const json = await res.json();
      const items = json.data?.items || json.data || [];
      const pagination = json.data?.pagination || json.meta || { total: items.length, totalPages: 1 };
      return { items, pagination };
    },
  });

  const items = transferData?.items || [];
  const pagination = transferData?.pagination || { total: 0, totalPages: 1 };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1">
            <Clock className="w-3 h-3" />
            {locale === "bn" ? "খসড়া" : "Draft"}
          </Badge>
        );
      case "sent":
        return (
          <Badge variant="outline" className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30 gap-1">
            <Truck className="w-3 h-3" />
            {locale === "bn" ? "ট্রানজিটে আছে" : "In Transit"}
          </Badge>
        );
      case "received":
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {locale === "bn" ? "গৃহীত" : "Received"}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 gap-1">
            <XCircle className="w-3 h-3" />
            {locale === "bn" ? "বাতিল" : "Cancelled"}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {locale === "bn" ? "স্টক ট্রান্সফার" : "Stock Transfers"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {locale === "bn"
              ? "বিভিন্ন শাখার মধ্যে পণ্য পাঠানো ও গ্রহণের হিসাব রাখুন"
              : "Track branch-to-branch inventory dispatches and receipts"}
          </p>
        </div>

        {hasPermission("transfer.create") && (
          <Link href="/inventory/transfers/new">
            <Button data-testid="new-transfer-button" className="gap-2">
              <Plus className="w-4 h-4" />
              {locale === "bn" ? "নতুন ট্রান্সফার" : "New Transfer"}
            </Button>
          </Link>
        )}
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-card p-4 rounded-lg border border-border">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: "all", labelBn: "সকল", labelEn: "All" },
            { id: "draft", labelBn: "খসড়া", labelEn: "Draft" },
            { id: "sent", labelBn: "ট্রানজিট", labelEn: "In Transit" },
            { id: "received", labelBn: "গৃহীত", labelEn: "Received" },
            { id: "cancelled", labelBn: "বাতিল", labelEn: "Cancelled" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setStatusFilter(tab.id);
                setPage(1);
              }}
              data-testid={`filter-tab-${tab.id}`}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.id
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {locale === "bn" ? tab.labelBn : tab.labelEn}
            </button>
          ))}
        </div>

        {/* Search & Branch Filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder={locale === "bn" ? "ট্রান্সফার নম্বর দিয়ে খুঁজুন..." : "Search transfer #..."}
              className="pl-9 h-9 text-xs"
              data-testid="transfers-search-input"
            />
          </div>

          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              setPage(1);
            }}
            data-testid="branch-filter-select"
            className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            <option value="">{locale === "bn" ? "সকল শাখা" : "All Branches"}</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <Table data-testid="transfers-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">{locale === "bn" ? "ট্রান্সফার নম্বর" : "Transfer #"}</TableHead>
              <TableHead className="w-[140px]">{locale === "bn" ? "তারিখ" : "Date"}</TableHead>
              <TableHead>{locale === "bn" ? "উৎস ও গন্তব্য শাখা" : "Source & Destination"}</TableHead>
              <TableHead className="w-[130px]">{locale === "bn" ? "স্ট্যাটাস" : "Status"}</TableHead>
              <TableHead className="w-[100px] text-right">{locale === "bn" ? "আইটেম" : "Items"}</TableHead>
              <TableHead className="w-[120px] text-right">{locale === "bn" ? "মোট পরিমাণ" : "Total Qty"}</TableHead>
              <TableHead className="w-[140px] text-right">{locale === "bn" ? "অ্যাকশন" : "Actions"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                  {locale === "bn" ? "লোড হচ্ছে..." : "Loading transfers..."}
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                  {locale === "bn" ? "কোন ট্রান্সফার পাওয়া যায়নি" : "No stock transfers found"}
                </TableCell>
              </TableRow>
            ) : (
              items.map((t: any) => {
                const totalSent = t.items?.reduce((sum: number, it: any) => sum + Number(it.sentQty || 0), 0) ?? t.totalSentQty ?? 0;
                const formattedDate = new Date(t.createdAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });

                return (
                  <TableRow key={t.id} data-testid="transfer-row" className="h-[56px] hover:bg-muted/40 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold text-foreground">
                      <Link href={`/inventory/transfers/${t.id}`} className="hover:underline text-primary">
                        {t.transferNumber}
                      </Link>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {formattedDate}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-foreground">{t.sourceBranch?.name || t.sourceBranchId}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground">{t.destinationBranch?.name || t.destinationBranchId}</span>
                      </div>
                    </TableCell>

                    <TableCell data-testid="transfer-status-cell">
                      {getStatusBadge(t.status)}
                    </TableCell>

                    <TableCell className="text-right text-xs font-mono tabular-nums">
                      {t.items?.length ?? t.itemsCount ?? 0}
                    </TableCell>

                    <TableCell className="text-right text-xs font-mono font-semibold tabular-nums">
                      {totalSent}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/inventory/transfers/${t.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" data-testid="view-transfer-btn">
                            <FileText className="w-3.5 h-3.5 mr-1" />
                            {locale === "bn" ? "বিস্তারিত" : "View"}
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <span>
            {locale === "bn"
              ? `মোট ${pagination.total} টি ট্রান্সফারের মধ্যে ${items.length} টি দেখানো হচ্ছে`
              : `Showing ${items.length} of ${pagination.total} transfers`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 text-xs"
            >
              {locale === "bn" ? "পূর্ববর্তী" : "Previous"}
            </Button>
            <span className="font-medium px-2">
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              className="h-8 text-xs"
            >
              {locale === "bn" ? "পরবর্তী" : "Next"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
