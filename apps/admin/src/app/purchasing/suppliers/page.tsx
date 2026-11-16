"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  FileText,
  CreditCard,
  Edit,
  Building2,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  balancePoisha?: number;
}

interface StatementEntry {
  id: string;
  type: string;
  date: string;
  reference: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  runningBalanceMinor: number;
}

export default function SuppliersPage() {
  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Supplier Create/Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formName, setFormName] = useState("");
  const [formContactName, setFormContactName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Statement Modal State
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [statementEntries, setStatementEntries] = useState<StatementEntry[]>([]);
  const [statementOpening, setStatementOpening] = useState(0);
  const [statementClosing, setStatementClosing] = useState(0);
  const [statementLoading, setStatementLoading] = useState(false);

  // Payment Modal State
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "cheque" | "mobile_banking">("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);

  const fetchSuppliers = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    async function loadData() {
      try {
        setLoading(true);
        const queryParams = new URLSearchParams();
        if (debouncedSearch.trim()) queryParams.set("search", debouncedSearch.trim());

        const res = await apiFetch(`/suppliers?${queryParams.toString()}`);
        if (res.ok && isCurrent) {
          const json = await res.json();
          const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
          
          // Fetch balances in parallel
          const withBalances: Supplier[] = await Promise.all(
            items.map(async (sup: Supplier) => {
              try {
                const bRes = await apiFetch(`/suppliers/${sup.id}/balance`);
                if (bRes.ok) {
                  const bJson = await bRes.json();
                  return {
                    ...sup,
                    balancePoisha:
                      bJson.data?.currentBalanceMinor ??
                      bJson.data?.balanceMinor ??
                      bJson.data?.balancePoisha ??
                      0,
                  };
                }
              } catch {
                // ignore individual balance failure
              }
              return { ...sup, balancePoisha: 0 };
            })
          );
          if (isCurrent) {
            setSuppliers(withBalances);
          }
        }
      } catch (err: any) {
        if (isCurrent) setErrorMessage(err.message || "Failed to load suppliers");
      } finally {
        if (isCurrent) setLoading(false);
      }
    }
    loadData();
    return () => {
      isCurrent = false;
    };
  }, [debouncedSearch, refreshIndex]);

  // Open Create/Edit Modal
  const openCreateModal = () => {
    setEditingSupplier(null);
    setFormName("");
    setFormContactName("");
    setFormPhone("");
    setFormEmail("");
    setFormAddress("");
    setFormNotes("");
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormName(supplier.name);
    setFormContactName(supplier.contactName || "");
    setFormPhone(supplier.phone || "");
    setFormEmail(supplier.email || "");
    setFormAddress(supplier.address || "");
    setFormNotes(supplier.notes || "");
    setIsModalOpen(true);
  };

  // Submit Create/Edit Supplier
  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    try {
      setSaving(true);
      setErrorMessage(null);

      const payload = {
        name: formName.trim(),
        contactName: formContactName.trim() || undefined,
        phone: formPhone.trim() || undefined,
        email: formEmail.trim() || undefined,
        address: formAddress.trim() || undefined,
        notes: formNotes.trim() || undefined,
      };

      const url = editingSupplier ? `/suppliers/${editingSupplier.id}` : "/suppliers";
      const method = editingSupplier ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || "Operation failed");
      }

      setSuccessMessage(
        editingSupplier
          ? strings.purchasing.supplierUpdated
          : strings.purchasing.supplierCreated
      );
      setIsModalOpen(false);
      fetchSuppliers();
    } catch (err: any) {
      setErrorMessage(err.message || "Error saving supplier");
    } finally {
      setSaving(false);
    }
  };

  // Open Statement
  const openStatement = async (supplier: Supplier) => {
    setStatementSupplier(supplier);
    setStatementLoading(true);
    try {
      const res = await apiFetch(`/suppliers/${supplier.id}/statement`);
      if (res.ok) {
        const json = await res.json();
        setStatementOpening(json.data?.openingBalanceMinor ?? 0);
        setStatementClosing(json.data?.closingBalanceMinor ?? 0);
        setStatementEntries(json.data?.items ?? []);
      }
    } catch {
      setErrorMessage("Failed to load supplier statement");
    } finally {
      setStatementLoading(false);
    }
  };

  // Submit Payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentSupplier || !paymentAmount || Number(paymentAmount) <= 0) return;

    try {
      setRecordingPayment(true);
      setErrorMessage(null);

      const amountMinor = Math.round(Number(paymentAmount) * 100);
      const res = await apiFetch("/supplier-payments", {
        method: "POST",
        body: JSON.stringify({
          supplierId: paymentSupplier.id,
          amountMinor,
          paymentMethod,
          reference: paymentReference.trim() || undefined,
          notes: paymentNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to record payment");
      }

      setSuccessMessage(strings.purchasing.paymentRecorded);
      setPaymentSupplier(null);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNotes("");
      fetchSuppliers();
    } catch (err: any) {
      setErrorMessage(err.message || "Error recording payment");
    } finally {
      setRecordingPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Heading */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.purchasing.suppliersList}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            সরবরাহকারী প্রতিষ্ঠান, বর্তমান বকেয়া ও লেনদেন বিবরণী পরিচালনা করুন
          </p>
        </div>

        {hasPermission("purchase.manage") && (
          <Button
            onClick={openCreateModal}
            data-testid="btn-add-supplier"
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>{strings.purchasing.createSupplier}</span>
          </Button>
        )}
      </div>

      {/* Alerts */}
      {successMessage && (
        <div
          data-testid="success-alert"
          role="alert"
          className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-sm text-emerald-600 dark:text-emerald-400 flex justify-between items-center"
        >
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs underline ml-4"
          >
            বন্ধ করুন
          </button>
        </div>
      )}

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

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="সরবরাহকারীর নাম বা ফোন নম্বর দিয়ে খুঁজুন..."
            className="pl-9 h-10"
            data-testid="supplier-search-input"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={fetchSuppliers}
          title="রিফ্রেশ করুন"
          className="h-10 w-10 shrink-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Suppliers Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="suppliers-table">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold uppercase">
              <tr>
                <th className="px-6 py-3.5">সরবরাহকারী ও যোগাযোগ</th>
                <th className="px-6 py-3.5">যোগাযোগের তথ্য</th>
                <th className="px-6 py-3.5">ঠিকানা</th>
                <th className="px-6 py-3.5 text-right">{strings.purchasing.balance}</th>
                <th className="px-6 py-3.5 text-right">কার্যক্রম</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                    তথ্য লোড হচ্ছে...
                  </td>
                </tr>
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                    কোন সরবরাহকারী পাওয়া যায়নি
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr
                    key={s.id}
                    data-testid="supplier-row"
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-foreground block">
                            {s.name}
                          </span>
                          {s.contactName && (
                            <span className="text-xs text-muted-foreground">
                              যোগাযোগ: {s.contactName}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-muted-foreground space-y-1">
                      {s.phone && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          <span>{s.phone}</span>
                        </div>
                      )}
                      {s.email && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span>{s.email}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 text-xs text-muted-foreground max-w-[200px] truncate">
                      {s.address ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{s.address}</span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <span
                        className={`font-mono font-semibold text-sm ${
                          (s.balancePoisha ?? 0) > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-foreground"
                        }`}
                        data-testid="supplier-balance"
                      >
                        {formatMoney(s.balancePoisha ?? 0)}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right space-x-1 whitespace-nowrap">
                      {/* Statement Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openStatement(s)}
                        data-testid="btn-statement"
                        title={strings.purchasing.statement}
                        className="h-8 px-2 text-xs"
                      >
                        <FileText className="h-3.5 w-3.5 mr-1" />
                        <span>বিবরণী</span>
                      </Button>

                      {/* Payment Button */}
                      {hasPermission("purchase.manage") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPaymentSupplier(s);
                            setPaymentAmount("");
                            setPaymentReference("");
                            setPaymentNotes("");
                          }}
                          data-testid="btn-pay-supplier"
                          title={strings.purchasing.recordPayment}
                          className="h-8 px-2 text-xs"
                        >
                          <CreditCard className="h-3.5 w-3.5 mr-1" />
                          <span>পেমেন্ট</span>
                        </Button>
                      )}

                      {/* Edit Button */}
                      {hasPermission("purchase.manage") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(s)}
                          data-testid="btn-edit-supplier"
                          className="h-8 w-8 p-0"
                          title="সম্পাদনা"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create/Edit Supplier */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSupplier
                ? strings.purchasing.editSupplier
                : strings.purchasing.createSupplier}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveSupplier} className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.supplierName} *
              </label>
              <Input
                id="supplier-name"
                data-testid="supplier-name-input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="যেমন: ফ্যাশন টেক্সটাইল লিঃ"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.contactName}
              </label>
              <Input
                id="supplier-contact"
                data-testid="supplier-contact-input"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
                placeholder="যেমন: মোঃ রফিকুল ইসলাম"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {strings.purchasing.supplierPhone}
                </label>
                <Input
                  id="supplier-phone"
                  data-testid="supplier-phone-input"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="01700000000"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {strings.purchasing.email}
                </label>
                <Input
                  id="supplier-email"
                  data-testid="supplier-email-input"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="vendor@example.com"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.address}
              </label>
              <Input
                id="supplier-address"
                data-testid="supplier-address-input"
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="ঠিকানা ও অবস্থান"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.notes}
              </label>
              <Input
                id="supplier-notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="অতিরিক্ত কোনো তথ্য বা শর্ত..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                disabled={saving}
              >
                বাতিল
              </Button>
              <Button
                type="submit"
                data-testid="supplier-submit-btn"
                disabled={saving}
              >
                {saving ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Supplier Statement */}
      <Dialog
        open={!!statementSupplier}
        onOpenChange={(open) => !open && setStatementSupplier(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {statementSupplier?.name} — {strings.purchasing.statementTitle}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Balance Summary Header */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border border-border text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">
                  {strings.purchasing.openingBalance}
                </span>
                <span className="font-mono font-semibold">
                  {formatMoney(statementOpening)}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">
                  {strings.purchasing.closingBalance}
                </span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                  {formatMoney(statementClosing)}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-xs text-muted-foreground block">মোট লেনদেন</span>
                <span className="font-semibold">{statementEntries.length} টি</span>
              </div>
            </div>

            {/* Statement Entries Table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs text-left" data-testid="statement-table">
                <thead className="bg-muted/60 border-b border-border uppercase font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">{strings.purchasing.date}</th>
                    <th className="px-4 py-2.5">বিবরণ / রেফারেন্স</th>
                    <th className="px-4 py-2.5 text-right">{strings.purchasing.debit}</th>
                    <th className="px-4 py-2.5 text-right">{strings.purchasing.credit}</th>
                    <th className="px-4 py-2.5 text-right">{strings.purchasing.runningBalance}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {statementLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        বিবরণী লোড হচ্ছে...
                      </td>
                    </tr>
                  ) : statementEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        এই সরবরাহকারীর কোনো পূর্ববর্তী লেনদেন পাওয়া যায়নি
                      </td>
                    </tr>
                  ) : (
                    statementEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono">
                          {new Date(entry.date).toLocaleDateString("bn-BD")}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold block capitalize">
                            {entry.type === "goods_receipt" || entry.type === "bill"
                              ? "পণ্য চালান (GRN)"
                              : "পেমেন্ট পরিশোধ"}
                          </span>
                          <span className="text-muted-foreground font-mono">
                            {entry.reference}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground">
                          {entry.debitMinor > 0 ? formatMoney(entry.debitMinor) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {entry.creditMinor > 0 ? formatMoney(entry.creditMinor) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">
                          {formatMoney(entry.runningBalanceMinor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStatementSupplier(null)}>
                বন্ধ করুন
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Record Supplier Payment */}
      <Dialog
        open={!!paymentSupplier}
        onOpenChange={(open) => !open && setPaymentSupplier(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {strings.purchasing.recordPayment} — {paymentSupplier?.name}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleRecordPayment} className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
              বর্তমান বকেয়া (ব্যালেন্স):{" "}
              <span className="font-mono font-bold">
                {formatMoney(paymentSupplier?.balancePoisha ?? 0)}
              </span>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.paymentAmount} (টাকা) *
              </label>
              <Input
                id="payment-amount"
                data-testid="payment-amount-input"
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.paymentMethod} *
              </label>
              <select
                id="payment-method"
                data-testid="payment-method-select"
                value={paymentMethod}
                onChange={(e: any) => setPaymentMethod(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="cash">{strings.purchasing.payMethodCash}</option>
                <option value="bank_transfer">{strings.purchasing.payMethodBank}</option>
                <option value="cheque">{strings.purchasing.payMethodCheque}</option>
                <option value="mobile_banking">{strings.purchasing.payMethodMfs}</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                রেফারেন্স / চেক নং / ট্রানজেকশন আইডি
              </label>
              <Input
                id="payment-ref"
                data-testid="payment-ref-input"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="যেমন: TR-98213 বা CHQ-4401"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {strings.purchasing.notes}
              </label>
              <Input
                id="payment-notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="পেমেন্ট সংক্রান্ত কোনো বিবরণ..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaymentSupplier(null)}
                disabled={recordingPayment}
              >
                বাতিল
              </Button>
              <Button
                type="submit"
                data-testid="payment-submit-btn"
                disabled={recordingPayment}
              >
                {recordingPayment ? "রেকর্ড হচ্ছে..." : "পেমেন্ট নিশ্চিত করুন"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
