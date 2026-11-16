"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import { Plus, Search, Shirt, Edit2 } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export default function ProductsPage() {
  const router = useRouter();
  const { strings, locale } = useTranslation();
  const { apiFetch, currentBranch } = useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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
    queryKey: ["products-list", page, pageSize, searchTerm, selectedCategory, currentBranch?.id],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", pageSize.toString());
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
  const totalItems = productsData?.pagination?.total ?? products.length;

  return (
    <PermissionGate permission="catalog.read">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {strings.products.title}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {locale === "bn"
                ? "দোকানের সকল পণ্যের ক্যাটালগ ও ভ্যারিয়েন্ট ব্যবস্থাপনা"
                : "Manage your product catalog and variants"}
            </p>
          </div>
          <Link href="/catalog/products/new">
            <Button className="flex items-center gap-1.5 self-start sm:self-auto h-9">
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
                  placeholder={locale === "bn" ? "নাম, এসকেইউ অথবা বারকোড দিয়ে খুঁজুন..." : "Search by name, SKU or barcode..."}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="w-full sm:w-56">
                <Select
                  value={selectedCategory}
                  onValueChange={(val) => {
                    setSelectedCategory(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allCategories}>
                    <SelectValue placeholder={strings.selectEmpty.allCategories} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                      {strings.selectEmpty.allCategories}
                    </SelectItem>
                    {categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs sm:text-sm">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products Table */}
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[320px]">{strings.products.productName}</TableHead>
                  <TableHead className="hidden md:table-cell">{strings.products.category}</TableHead>
                  <TableHead className="text-right w-24">{strings.products.variantCount}</TableHead>
                  <TableHead className="text-right w-40">{strings.products.priceRange}</TableHead>
                  <TableHead className="text-right w-28">{strings.products.totalStock}</TableHead>
                  <TableHead className="text-center w-24">{strings.common.status}</TableHead>
                  <TableHead className="text-right w-16">{strings.common.actions}</TableHead>
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
                      priceDisplay =
                        minPrice === maxPrice
                          ? formatMoney(minPrice)
                          : `${formatMoney(minPrice)} – ${formatMoney(maxPrice)}`;
                    }

                    // Calculate total stock
                    let totalStock = product.totalStock !== undefined ? Number(product.totalStock) : 0;
                    if (product.totalStock === undefined) {
                      variantsList.forEach((v: any) => {
                        if (v.stockLevels) {
                          v.stockLevels.forEach((sl: any) => {
                            totalStock += Number(sl.qty || sl.quantity || 0);
                          });
                        } else if (v.totalStock !== undefined) {
                          totalStock += Number(v.totalStock);
                        }
                      });
                    }

                    return (
                      <TableRow
                        key={product.id}
                        onClick={() => router.push(`/catalog/products/${product.id}`)}
                        className="cursor-pointer hover:bg-muted/40 h-[56px]"
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                              <Shirt className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="truncate font-semibold text-sm text-foreground">
                                {product.name}
                              </span>
                              <span className="text-[11px] font-mono text-muted-foreground">
                                {product.sku}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {product.category?.name || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {variantCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs sm:text-sm font-semibold text-foreground">
                          {priceDisplay}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs font-semibold text-foreground">
                          {totalStock}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={product.isActive ? "success" : "secondary"}
                            className="text-[11px]"
                          >
                            {product.isActive ? strings.common.active : strings.common.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/catalog/products/${product.id}`} aria-label={`${strings.common.edit}: ${product.name}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`${strings.common.edit}: ${product.name}`}>
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
            <DataTablePagination
              page={page}
              pageSize={pageSize}
              total={totalItems}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}
