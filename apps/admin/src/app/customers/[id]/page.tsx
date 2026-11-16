"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Edit2,
  CreditCard,
  ShoppingBag,
  RefreshCw,
  CheckCircle2,
  Receipt,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface CustomerSale {
  id: string;
  invoiceNumber: string;
  totalMinor: number;
  status: string;
  createdAt: string;
}

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  totalSpentMinor: number;
  totalVisits: number;
  createdAt: string;
  sales?: CustomerSale[];
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const customerId = resolvedParams.id;

  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await apiFetch(`/customers/${customerId}`);
      if (res.ok) {
        const json = await res.json();
        setCustomer(json.data);
      } else {
        setErrorMessage("Failed to load customer profile");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const openEdit = () => {
    if (!customer) return;
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || "",
      notes: customer.notes || "",
    });
    setEditError(null);
    setEditSuccess(false);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);

    try {
      setEditLoading(true);
      const res = await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim() || undefined,
          address: formData.address.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        }),
      });

      if (res.ok) {
        setEditSuccess(true);
        setTimeout(() => {
          setShowEditModal(false);
          setEditSuccess(false);
          fetchCustomer();
        }, 800);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setEditError(errJson.message || errJson.error?.message || "Failed to update customer");
      }
    } catch {
      setEditError("Network connection error");
    } finally {
      setEditLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
      </div>
    );
  }

  if (errorMessage || !customer) {
    return (
      <div className="space-y-4">
        <Link href="/customers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {strings.common.back}
          </Button>
        </Link>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage || "Customer not found"}
        </div>
      </div>
    );
  }

  const avgOrderValue =
    customer.totalVisits > 0
      ? Math.round(customer.totalSpentMinor / customer.totalVisits)
      : 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Link href="/customers">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {strings.common.back}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {customer.name}
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {customer.phone}
            </p>
          </div>
        </div>

        {hasPermission("customer.manage") && (
          <Button size="sm" onClick={openEdit}>
            <Edit2 className="h-4 w-4 mr-1.5" />
            {strings.customers.editCustomer}
          </Button>
        )}
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CreditCard className="h-4 w-4 text-primary" />
            <span>{strings.customers.totalSpent}</span>
          </div>
          <span className="text-2xl font-bold text-foreground">
            {formatMoney(customer.totalSpentMinor || 0)}
          </span>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ShoppingBag className="h-4 w-4 text-emerald-500" />
            <span>{strings.customers.totalVisits}</span>
          </div>
          <span className="text-2xl font-bold text-foreground">
            {customer.totalVisits || 0}
          </span>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Receipt className="h-4 w-4 text-blue-500" />
            <span>Average Order Value</span>
          </div>
          <span className="text-2xl font-bold text-foreground">
            {formatMoney(avgOrderValue)}
          </span>
        </div>
      </div>

      {/* Profile Info Details */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-xs space-y-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
          Contact & Information
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">{strings.customers.phone}</span>
            <span className="font-mono text-foreground font-medium">{customer.phone}</span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block">{strings.customers.email}</span>
            <span className="text-foreground">{customer.email || "-"}</span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block">{strings.customers.address}</span>
            <span className="text-foreground">{customer.address || "-"}</span>
          </div>
        </div>

        {customer.notes && (
          <div className="pt-3 border-t border-border">
            <span className="text-xs text-muted-foreground block">{strings.customers.notes}</span>
            <p className="text-xs text-foreground mt-1 bg-muted/40 p-2.5 rounded-lg border border-border">
              {customer.notes}
            </p>
          </div>
        )}
      </div>

      {/* Purchase History */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {strings.customers.purchaseHistory}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs">
              <tr>
                <th className="py-2.5 px-4">{strings.sales.receiptNumber}</th>
                <th className="py-2.5 px-4">{strings.sales.dateTime}</th>
                <th className="py-2.5 px-4 text-center">{strings.common.status}</th>
                <th className="py-2.5 px-4 text-right">{strings.sales.total}</th>
                <th className="py-2.5 px-4 text-center">{strings.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!customer.sales || customer.sales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    {strings.customers.noPurchases}
                  </td>
                </tr>
              ) : (
                customer.sales.map((s) => {
                  const isVoided = s.status === "voided";
                  return (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-foreground">
                        <Link href={`/sales/${s.id}`} className="hover:underline text-primary">
                          {s.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">
                        {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={isVoided ? "destructive" : "default"}
                          className={`text-xs font-normal ${
                            isVoided ? "bg-red-500/10 text-red-600 border-red-200" : "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                          }`}
                        >
                          {isVoided ? strings.sales.statusVoided : strings.sales.statusCompleted}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-foreground">
                        <span className={isVoided ? "line-through text-muted-foreground" : ""}>
                          {formatMoney(s.totalMinor)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Link href={`/sales/${s.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            {strings.sales.viewSale}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Customer Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground">
              {strings.customers.editCustomer}
            </h2>

            {editSuccess ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {strings.customers.customerSaved}
              </div>
            ) : (
              <form onSubmit={handleEditSubmit} className="space-y-3">
                {editError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                    {editError}
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
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.address}
                  </label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.customers.notes}
                  </label>
                  <Input
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowEditModal(false)}
                    disabled={editLoading}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button type="submit" disabled={editLoading}>
                    {editLoading ? strings.common.loading : strings.common.save}
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
