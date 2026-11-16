"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useTranslation } from "@/i18n/context";
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
import { Plus, Search, Filter, Shirt, Edit2 } from "lucide-react";

interface DemoProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  variantsCount: number;
  priceRange: string;
  stock: number;
  isActive: boolean;
}

const sampleProducts: DemoProduct[] = [
  {
    id: "prod-1",
    name: "প্রিমিয়াম ফরমাল শার্ট (Slim Fit Cotton Shirt)",
    sku: "SHT-SLM-01",
    category: "শার্ট (Shirts)",
    variantsCount: 12,
    priceRange: "৳ ১,৮৫০ - ৳ ২,১৫০",
    stock: 48,
    isActive: true,
  },
  {
    id: "prod-2",
    name: "ক্যাজুয়াল পোলো শার্ট (Polo Shirt)",
    sku: "SHT-POLO-02",
    category: "পোলো (Polo)",
    variantsCount: 8,
    priceRange: "৳ ১,২০০",
    stock: 22,
    isActive: true,
  },
  {
    id: "prod-3",
    name: "ডেনিম জিন্স প্যান্ট (Denim Jeans)",
    sku: "PNT-DNM-01",
    category: "প্যান্ট (Pants)",
    variantsCount: 6,
    priceRange: "৳ ২,৪৫০",
    stock: 5,
    isActive: true,
  },
  {
    id: "prod-4",
    name: "ঐতিহ্যবাহী পাঞ্জাবি (Traditional Panjabi)",
    sku: "PNJ-TRD-01",
    category: "পাঞ্জাবি (Panjabi)",
    variantsCount: 10,
    priceRange: "৳ ৩,৫০০",
    stock: 0,
    isActive: false,
  },
];

export default function ProductsPage() {
  const { strings, locale } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filtered = sampleProducts.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <AppShell requiredPermission="products.read">
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
          <Button className="flex items-center gap-1.5 self-start sm:self-auto">
            <Plus className="h-4 w-4" />
            <span>{strings.products.createProduct}</span>
          </Button>
        </div>

        {/* Filters and Search Bar */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={strings.common.search}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-xs sm:text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-full sm:w-44"
                >
                  <option value="all">{strings.common.all} {strings.products.category}</option>
                  <option value="shirts">শার্ট (Shirts)</option>
                  <option value="polo">পোলো (Polo)</option>
                  <option value="pants">প্যান্ট (Pants)</option>
                  <option value="panjabi">পাঞ্জাবি (Panjabi)</option>
                </select>

                <Button variant="outline" size="sm" className="h-9 px-3 gap-1.5 shrink-0">
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{strings.common.filter}</span>
                </Button>
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
                  <TableHead className="w-[300px]">{strings.products.productName}</TableHead>
                  <TableHead>{strings.products.sku}</TableHead>
                  <TableHead className="hidden md:table-cell">{strings.products.category}</TableHead>
                  <TableHead className="text-center">{strings.products.variantCount}</TableHead>
                  <TableHead className="text-right">{strings.products.priceRange}</TableHead>
                  <TableHead className="text-center">{strings.products.totalStock}</TableHead>
                  <TableHead className="text-center">{strings.common.status}</TableHead>
                  <TableHead className="text-right">{strings.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Shirt className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <span className="truncate">{product.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {product.sku}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {product.category}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {product.variantsCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {product.priceRange}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          product.stock > 10
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : product.stock > 0
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {product.stock}
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
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
