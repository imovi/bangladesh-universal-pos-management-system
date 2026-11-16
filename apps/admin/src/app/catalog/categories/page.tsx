"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, AlertCircle, CheckCircle2, Tags, Layers, Bookmark, Percent } from "lucide-react";

type TabKey = "categories" | "brands" | "collections" | "taxClasses";

export default function CatalogMetadataPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("categories");
  const [modalType, setModalType] = useState<"create" | "edit" | null>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formParentId, setFormParentId] = useState("");
  const [formRatePercent, setFormRatePercent] = useState("5");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Queries
  const { data: categories = [] } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/categories");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["catalog-brands"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/brands");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: collections = [] } = useQuery({
    queryKey: ["catalog-collections"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/collections");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: taxClasses = [] } = useQuery({
    queryKey: ["catalog-tax-classes"],
    queryFn: async () => {
      const res = await apiFetch("/catalog/tax-classes");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      let endpoint = `/catalog/${activeTab === "taxClasses" ? "tax-classes" : activeTab}`;
      const method = modalType === "create" ? "POST" : "PATCH";
      if (modalType === "edit") {
        endpoint = `${endpoint}/${editingItem.id}`;
      }

      let payload: any = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        isActive: formIsActive,
      };

      if (activeTab === "categories") {
        payload.parentCategoryId = formParentId || null;
      } else if (activeTab === "taxClasses") {
        payload.rateBp = Math.round(Number(formRatePercent) * 100);
        payload.isDefault = formIsDefault;
      }

      const res = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || "Operation failed");
      }
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`catalog-${activeTab === "taxClasses" ? "tax-classes" : activeTab}`],
      });
      setModalType(null);
      setEditingItem(null);
      setSuccessMessage("সফলভাবে সংরক্ষণ করা হয়েছে (Saved successfully)");
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  const openCreateModal = () => {
    setModalType("create");
    setEditingItem(null);
    setFormName("");
    setFormDescription("");
    setFormParentId("");
    setFormRatePercent("5");
    setFormIsDefault(false);
    setFormIsActive(true);
    setErrorMessage(null);
  };

  const openEditModal = (item: any) => {
    setModalType("edit");
    setEditingItem(item);
    setFormName(item.name || "");
    setFormDescription(item.description || "");
    setFormParentId(item.parentCategoryId || "");
    setFormRatePercent(item.rateBp ? (item.rateBp / 100).toString() : "5");
    setFormIsDefault(item.isDefault || false);
    setFormIsActive(item.isActive ?? true);
    setErrorMessage(null);
  };

  return (
    <AppShell requiredPermission="catalog.read">
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strings.nav.categories}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {locale === "bn"
                ? "ক্যাটাগরি, ব্র্যান্ড, কালেকশন এবং ভ্যাট/ট্যাক্স ক্লাস ব্যবস্থাপনা"
                : "Manage product categories, brands, collections and tax rates"}
            </p>
          </div>
          <Button onClick={openCreateModal} className="flex items-center gap-1.5 self-start sm:self-auto">
            <Plus className="h-4 w-4" />
            <span>নতুন যোগ করুন (Add New)</span>
          </Button>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 border-b pb-2 overflow-x-auto">
          <Button
            variant={activeTab === "categories" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("categories")}
            className="flex items-center gap-1.5 text-xs"
          >
            <Tags className="h-3.5 w-3.5" />
            <span>ক্যাটাগরি ({categories.length})</span>
          </Button>
          <Button
            variant={activeTab === "brands" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("brands")}
            className="flex items-center gap-1.5 text-xs"
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>ব্র্যান্ড ({brands.length})</span>
          </Button>
          <Button
            variant={activeTab === "collections" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("collections")}
            className="flex items-center gap-1.5 text-xs"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>কালেকশন ({collections.length})</span>
          </Button>
          <Button
            variant={activeTab === "taxClasses" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("taxClasses")}
            className="flex items-center gap-1.5 text-xs"
          >
            <Percent className="h-3.5 w-3.5" />
            <span>ভ্যাট / ট্যাক্স ক্লাস ({taxClasses.length})</span>
          </Button>
        </div>

        {/* Feedback message */}
        {successMessage && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Table View */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[280px]">নাম (Name)</TableHead>
                  {activeTab === "categories" && <TableHead>মূল ক্যাটাগরি (Parent)</TableHead>}
                  {activeTab === "taxClasses" && <TableHead className="text-right">ট্যাক্স রেট (%)</TableHead>}
                  {activeTab === "taxClasses" && <TableHead className="text-center">ডিফল্ট</TableHead>}
                  <TableHead className="hidden md:table-cell">বিবরণ (Description)</TableHead>
                  <TableHead className="text-center">{strings.common.status}</TableHead>
                  <TableHead className="text-right">{strings.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTab === "categories" && (
                  categories.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-semibold text-sm">{c.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.parent?.name || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{c.description || "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={c.isActive ? "success" : "outline"} className="text-[11px]">
                          {c.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(c)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {activeTab === "brands" && (
                  brands.map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-semibold text-sm">{b.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{b.description || "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={b.isActive ? "success" : "outline"} className="text-[11px]">
                          {b.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(b)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {activeTab === "collections" && (
                  collections.map((col: any) => (
                    <TableRow key={col.id}>
                      <TableCell className="font-semibold text-sm">{col.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{col.description || "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={col.isActive ? "success" : "outline"} className="text-[11px]">
                          {col.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(col)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {activeTab === "taxClasses" && (
                  taxClasses.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-semibold text-sm">{t.name}</TableCell>
                      <TableCell className="text-right font-bold text-sm">{(t.rateBp / 100).toFixed(2)}%</TableCell>
                      <TableCell className="text-center">
                        {t.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{t.description || "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={t.isActive ? "success" : "outline"} className="text-[11px]">
                          {t.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(t)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create / Edit Modal Dialog */}
        {modalType && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md shadow-xl border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">
                  {modalType === "create" ? "নতুন এন্ট্রি তৈরি করুন" : "তথ্য সম্পাদনা করুন"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {errorMessage && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="entryName">নাম (Name) *</Label>
                  <Input
                    id="entryName"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Menswear"
                    autoFocus
                  />
                </div>

                {activeTab === "categories" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="parentCategory">মূল ক্যাটাগরি (Parent Category)</Label>
                    <select
                      id="parentCategory"
                      value={formParentId}
                      onChange={(e) => setFormParentId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">-- শীর্ষ ক্যাটাগরি (Top Level) --</option>
                      {categories
                        .filter((c: any) => !editingItem || c.id !== editingItem.id)
                        .map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </div>
                )}

                {activeTab === "taxClasses" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="taxRate">ট্যাক্স রেট (Tax Rate %)</Label>
                      <Input
                        id="taxRate"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={formRatePercent}
                        onChange={(e) => setFormRatePercent(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        id="isDefaultTax"
                        type="checkbox"
                        checked={formIsDefault}
                        onChange={(e) => setFormIsDefault(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary"
                      />
                      <label htmlFor="isDefaultTax" className="text-xs select-none cursor-pointer">
                        দোকানের সাধারণ ডিফল্ট ভ্যাট রেট হিসেবে নির্ধারণ করুন
                      </label>
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="entryDesc">বিবরণ (Description)</Label>
                  <Input
                    id="entryDesc"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="isActiveToggle"
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary"
                  />
                  <label htmlFor="isActiveToggle" className="text-xs select-none cursor-pointer">
                    সক্রিয় অবস্থা (Active)
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" size="sm" onClick={() => setModalType(null)}>
                    {strings.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!formName.trim() || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {strings.common.save}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
