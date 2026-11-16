"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import {
  Users,
  Search,
  Plus,
  Eye,
  Edit2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { CreateCustomerSchema } from "@universal-pos/shared";

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  totalSpentMinor: number;
  totalVisits: number;
  createdAt: string;
}

export default function CustomersPage() {
  const router = useRouter();
  const { apiFetch, hasPermission } = useAuth();
  const { strings, locale } = useTranslation();

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState(false);

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);
      queryParams.set("page", page.toString());
      queryParams.set("limit", pageSize.toString());

      const res = await apiFetch(`/customers?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setCustomers(items);
        if (json.data?.meta) {
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage(strings.common.error);
      }
    } catch {
      setErrorMessage(strings.common.error);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, search, page, pageSize, strings.common.error]);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchCustomers();
    }, 250);
    return () => clearTimeout(handler);
  }, [fetchCustomers]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({ name: "", phone: "", email: "", address: "", notes: "" });
    setModalError(null);
    setModalSuccess(false);
    setShowModal(true);
  };

  const openEditModal = (c: CustomerRecord) => {
    setEditingId(c.id);
    setFormData({
      name: c.name,
      phone: c.phone,
      email: c.email || "",
      address: c.address || "",
      notes: c.notes || "",
    });
    setModalError(null);
    setModalSuccess(false);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim() || undefined,
      address: formData.address.trim() || undefined,
      notes: formData.notes.trim() || undefined,
    };

    if (!editingId) {
      const validation = CreateCustomerSchema.safeParse(payload);
      if (!validation.success) {
        setModalError(validation.error.errors[0]?.message || "Invalid customer data");
        return;
      }
    }

    try {
      setModalLoading(true);
      const url = editingId ? `/customers/${editingId}` : "/customers";
      const method = editingId ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setModalSuccess(true);
        setTimeout(() => {
          setShowModal(false);
          setModalSuccess(false);
          fetchCustomers();
        }, 800);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setModalError(errJson.message || errJson.error?.message || "Failed to save customer");
      }
    } catch {
      setModalError(strings.common.error);
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <span>{strings.customers.title}</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {strings.customers.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission("customer.manage") && (
            <Button onClick={openCreateModal} className="h-9">
              <Plus className="h-4 w-4 mr-1.5" />
              <span>{strings.customers.addCustomer}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
        <div className="max-w-md relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={strings.customers.searchPlaceholder}
            className="pl-9 h-9 text-xs sm:text-sm"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.customers.name}</TableHead>
              <TableHead className="w-40">{strings.customers.phone}</TableHead>
              <TableHead className="w-56">{strings.customers.email}</TableHead>
              <TableHead className="text-right w-28">{strings.customers.totalVisits}</TableHead>
              <TableHead className="text-right w-36">{strings.customers.totalSpent}</TableHead>
              <TableHead className="text-right w-28">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  {strings.common.loading}
                </TableCell>
              </TableRow>
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  {strings.common.noData}
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => {
                const displayName = c.name === "Walk-in Customer" ? strings.enums.customer.walkIn : c.name;
                return (
                  <TableRow
                    key={c.id}
                    onClick={() => router.push(`/customers/${c.id}`)}
                    className="cursor-pointer hover:bg-muted/30 h-[56px] transition-colors"
                  >
                    <TableCell className="font-semibold text-foreground text-xs sm:text-sm">
                      {displayName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground font-semibold">
                      {c.phone}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.email || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs sm:text-sm font-semibold text-foreground">
                      {c.totalVisits || 0}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground text-xs sm:text-sm">
                      {formatMoney(c.totalSpentMinor || 0)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/customers/${c.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            <span>{strings.common.details}</span>
                          </Button>
                        </Link>
                        {hasPermission("customer.manage") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => openEditModal(c)}
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            <span>{strings.common.edit}</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Dialog */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingId ? strings.customers.editCustomer : strings.customers.addCustomer}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {modalSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{strings.customers.customerSaved}</span>
              </div>
            )}

            {modalError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="custName" className="text-xs font-semibold">
                {strings.customers.name} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="custName"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Tanvir Ahmed"
                required
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custPhone" className="text-xs font-semibold">
                {strings.customers.phone} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="custPhone"
                value={formData.phone}
                onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                placeholder="017xxxxxxxx"
                required
                className="h-9 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custEmail" className="text-xs font-semibold">
                {strings.customers.email}
              </Label>
              <Input
                id="custEmail"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custAddr" className="text-xs font-semibold">
                {strings.customers.address}
              </Label>
              <Input
                id="custAddr"
                value={formData.address}
                onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value }))}
                placeholder={locale === "bn" ? "ঠিকানা লিখুন..." : "Address..."}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custNotes" className="text-xs font-semibold">
                {strings.customers.notes}
              </Label>
              <Input
                id="custNotes"
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                placeholder={locale === "bn" ? "মন্তব্য লিখুন..." : "Notes..."}
                className="h-9 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                {strings.common.cancel}
              </Button>
              <Button type="submit" disabled={modalLoading}>
                {modalLoading ? strings.common.loading : strings.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
