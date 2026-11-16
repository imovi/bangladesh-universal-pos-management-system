"use client";

import React, { useState } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Shirt, Edit2, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export default function ProductsPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch, currentBranch } = useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Fetch categories for filter dropdown
  const { data: categories = [] } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/categories");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  // Fetch products with search, category filter, branch filter and pagination
  const { data: productsData, isLoading } = useQuery({
    queryKey: ["products-list", page, searchTerm, selectedCategory, currentBranch?.id],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (selectedCategory && selectedCategory !== "all") params.set("categoryId", selectedCategory);
      if (currentBranch?.id) params.set("branchId", currentBranch.id);

      const res = await apiFetch(`/products?${params.toString()}`);
      if (!res.ok) return { items: [], pagination: { total: 0, totalPages: 1 } };
      const json = await res.json();
      return {
        items: json.data || [],
        pagination: json.meta?.pagination || { total: json.data?.length || 0, totalPages: 1 },
      };
    },
  });

  const products = productsData?.items || [];
  const pagination = productsData?.pagination || { total: 0, totalPages: 1 };

  return (
    <PermissionGate permission="catalog.read">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strings.products.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {locale === "bn"
                ? "দোকানের সকল পণ্যের ক্যাটালগ ও ভ্যারিয়েন্ট ব্যবস্থাপনা"
                : "Manage your product catalog and variants"}
            </p>
          </div>
          <Link href="/catalog/products/new">
            <Button className="flex items-center gap-1.5 self-start sm:self-auto">
              <Plus className="h-4 w-4" />
              <span>{strings.products.createProduct}</span>
            </Button>
          </Link>
        </div>

        {/* Filters and Search Bar */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={locale === "bn" ? "নাম, SKU অথবা বারকোড দিয়ে খুঁজুন..." : "Search by name, SKU or barcode..."}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setPage(1);
                  }}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-xs sm:text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-full sm:w-52"
                >
                  <option value="all">{strings.common.all} {strings.products.category}</option>
                  {categories.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products Table */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[320px]">{strings.products.productName}</TableHead>
                  <TableHead className="hidden md:table-cell">{strings.products.category}</TableHead>
                  <TableHead className="text-center">{strings.products.variantCount}</TableHead>
                  <TableHead className="text-right">{strings.products.priceRange}</TableHead>
                  <TableHead className="text-center">{strings.products.totalStock}</TableHead>
                  <TableHead className="text-center">{strings.common.status}</TableHead>
                  <TableHead className="text-right">{strings.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                      {strings.common.loading}
                    </TableCell>
                  </TableRow>
                ) : products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                      {strings.common.noData}
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((product: any) => {
                    const variantsList = product.variants || [];
                    const variantCount = variantsList.length;

                    // Calculate price range
                    let priceDisplay = "—";
                    if (variantCount > 0) {
                      const prices = variantsList.map((v: any) => Number(v.priceMinor));
                      const minPrice = Math.min(...prices);
                      const maxPrice = Math.max(...prices);
                      priceDisplay = minPrice === maxPrice
                        ? formatMoney(minPrice)
                        : `${formatMoney(minPrice)} - ${formatMoney(maxPrice)}`;
                    }

                    // Calculate total stock
                    let totalStock = product.totalStock !== undefined ? Number(product.totalStock) : 0;
                    if (product.totalStock === undefined) {
                      variantsList.forEach((v: any) => {
                        if (v.stockLevels) {
                          v.stockLevels.forEach((sl: any) => { totalStock += Number(sl.qty || sl.quantity || 0); });
                        } else if (v.totalStock !== undefined) {
                          totalStock += Number(v.totalStock);
                        }
                      });
                    }

                    return (
                      <TableRow key={product.id} className="hover:bg-muted/40">
                        <TableCell className="font-medium">
                          <Link href={`/catalog/products/${product.id}`} className="flex items-center gap-2.5 hover:underline group">
                            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10">
                              <Shirt className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="truncate font-semibold text-sm">{product.name}</span>
                              <span className="text-[11px] font-mono text-muted-foreground">{product.sku}</span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {product.category?.name || "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {variantCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-xs sm:text-sm">
                          {priceDisplay}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              totalStock > 10
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : totalStock > 0
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {totalStock}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={product.isActive ? "success" : "outline"}
                            className="text-[11px]"
                          >
                            {product.isActive ? strings.common.active : strings.common.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/catalog/products/${product.id}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  মোট {pagination.total} টি পণ্য • পৃষ্ঠা {page} / {pagination.totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}
