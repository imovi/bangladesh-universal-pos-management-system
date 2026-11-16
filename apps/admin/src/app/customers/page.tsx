"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  Search,
  Plus,
  Eye,
  Edit2,
  RefreshCw,
  CheckCircle2,
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
  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
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
      queryParams.set("limit", "20");

      const res = await apiFetch(`/customers?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setCustomers(items);
        if (json.data?.meta) {
          setTotalPages(json.data.meta.totalPages || 1);
          setTotalCount(json.data.meta.total || 0);
        } else {
          setTotalCount(items.length);
        }
      } else {
        setErrorMessage("Failed to load customers");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, search, page]);

  // Debounced search
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
        setModalError(errJson.message || errJson.error?.message || "Operation failed");
      }
    } catch {
      setModalError("Network connection error");
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            {strings.customers.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.customers.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchCustomers()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {strings.common.refresh}
          </Button>

          {hasPermission("customer.manage") && (
            <Button size="sm" onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-1.5" />
              {strings.customers.addCustomer}
            </Button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={strings.customers.searchPlaceholder}
            className="pl-9"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="py-3 px-4">{strings.customers.name}</th>
                <th className="py-3 px-4">{strings.customers.phone}</th>
                <th className="py-3 px-4">{strings.customers.email}</th>
                <th className="py-3 px-4 text-center">{strings.customers.totalVisits}</th>
                <th className="py-3 px-4 text-right">{strings.customers.totalSpent}</th>
                <th className="py-3 px-4 text-center">{strings.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    {strings.common.loading}
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    {strings.common.noData}
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">
                      <Link href={`/customers/${c.id}`} className="hover:underline text-primary">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-foreground">
                      {c.phone}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">
                      {c.email || "-"}
                    </td>
                    <td className="py-3 px-4 text-center font-medium text-foreground">
                      {c.totalVisits || 0}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-foreground">
                      {formatMoney(c.totalSpentMinor || 0)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Link href={`/customers/${c.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            {strings.sales.viewSale}
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
                            {strings.common.edit}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {strings.common.showing} {customers.length} {strings.common.of} {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                {strings.common.previous}
              </Button>
              <span className="text-xs text-foreground font-medium px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {strings.common.next}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Customer Modal (Create / Edit) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground">
              {editingId ? strings.customers.editCustomer : strings.customers.addCustomer}
            </h2>

            {modalSuccess ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {strings.customers.customerSaved}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {modalError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                    {modalError}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.name} *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.phone} *
                  </label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g. 01711223344"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.email}
                  </label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="e.g. customer@example.com"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.address}
                  </label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="e.g. House 12, Road 5, Dhanmondi, Dhaka"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.notes}
                  </label>
                  <Input
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Special preferences or VIP customer notes"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowModal(false)}
                    disabled={modalLoading}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button type="submit" disabled={modalLoading}>
                    {modalLoading ? strings.common.loading : strings.common.save}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
