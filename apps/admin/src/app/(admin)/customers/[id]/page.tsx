"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Edit2,
  CreditCard,
  ShoppingBag,
  RefreshCw,
  CheckCircle2,
  Receipt,
  FileText,
  Printer,
  DollarSign,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { formatSaleStatus } from "@/i18n/formatters";
import { v7 as uuidv7 } from "uuid";

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
  creditLimitMinor: number;
  totalSpentMinor: number;
  totalVisits: number;
  createdAt: string;
  sales?: CustomerSale[];
}

interface CustomerBalance {
  customerId: string;
  creditLimitMinor: number;
  totalSalesDueMinor: number;
  totalCollectedMinor: number;
  currentDueMinor: number;
  availableCreditMinor: number;
}

interface StatementItem {
  id: string;
  type: "sale" | "payment" | "return";
  date: string;
  reference: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  runningBalanceMinor: number;
  description?: string;
}

interface CustomerStatement {
  customer: {
    id: string;
    name: string;
    phone: string;
    creditLimitMinor: number;
  };
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  items: StatementItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const customerId = resolvedParams.id;

  const { apiFetch, hasPermission } = useAuth();
  const { strings, locale } = useTranslation();

  const [activeTab, setActiveTab] = useState<"statement" | "purchases">("statement");
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [statementLoading, setStatementLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Statement date filter
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    creditLimit: "0",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);

  // Collect Payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentShiftId, setPaymentShiftId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      const [custRes, balRes] = await Promise.all([
        apiFetch(`/customers/${customerId}`),
        apiFetch(`/customers/${customerId}/balance`),
      ]);

      if (custRes.ok) {
        const json = await custRes.json();
        setCustomer(json.data);
      } else {
        setErrorMessage(locale === "bn" ? "গ্রাহকের তথ্য লোড করা যায়নি" : "Failed to load customer profile");
      }

      if (balRes.ok) {
        const balJson = await balRes.json();
        setBalance(balJson.data);
      }
    } catch {
      setErrorMessage(locale === "bn" ? "নেটওয়ার্ক সংযোগ ত্রুটি" : "Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, customerId, locale]);

  const fetchStatement = useCallback(async () => {
    try {
      setStatementLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("limit", "100");

      const res = await apiFetch(`/customers/${customerId}/statement?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setStatement(json.data);
      }
    } catch {
      // silently ignore statement reload error
    } finally {
      setStatementLoading(false);
    }
  }, [apiFetch, customerId, startDate, endDate]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  useEffect(() => {
    if (activeTab === "statement") {
      fetchStatement();
    }
  }, [activeTab, fetchStatement]);

  // Load active shift for payment collection
  const openCollectPayment = async () => {
    setPaymentError(null);
    setPaymentSuccess(false);
    setPaymentAmount(balance?.currentDueMinor ? (balance.currentDueMinor / 100).toString() : "");
    setPaymentMethod("cash");
    setPaymentRef("");
    setPaymentNotes("");
    setShowPaymentModal(true);

    try {
      const shiftRes = await apiFetch("/shifts?status=open&limit=1");
      if (shiftRes.ok) {
        const shiftJson = await shiftRes.json();
        const activeShift = shiftJson.data?.items?.[0] || shiftJson.data?.[0];
        if (activeShift) {
          setPaymentShiftId(activeShift.id);
        } else {
          setPaymentShiftId(null);
          setPaymentError(locale === "bn" ? "কোন খোলা শিফট নেই! বাকি আদায়ের জন্য একটি শিফট চালু থাকতে হবে।" : "No active open shift found. An open shift is required to collect due payment.");
        }
      }
    } catch {
      setPaymentError(locale === "bn" ? "শিফট তথ্য যাচাই করা যায়নি" : "Could not verify shift status");
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);

    const amountNum = parseFloat(paymentAmount);
    if (!amountNum || amountNum <= 0) {
      setPaymentError(locale === "bn" ? "টাকার পরিমাণ সঠিক নয়" : "Please enter a valid amount");
      return;
    }
    if (!paymentShiftId) {
      setPaymentError(locale === "bn" ? "বাকি আদায় করতে খোলা শিফট আবশ্যক" : "Active open shift is required");
      return;
    }

    try {
      setPaymentLoading(true);
      const res = await apiFetch(`/customers/${customerId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          id: uuidv7(),
          shiftId: paymentShiftId,
          amountMinor: Math.round(amountNum * 100),
          paymentMethod,
          reference: paymentRef.trim() || undefined,
          notes: paymentNotes.trim() || undefined,
        }),
      });

      if (res.ok) {
        setPaymentSuccess(true);
        setTimeout(() => {
          setShowPaymentModal(false);
          setPaymentSuccess(false);
          fetchCustomer();
          fetchStatement();
        }, 1000);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setPaymentError(errJson.message || errJson.error?.message || "Failed to record payment");
      }
    } catch {
      setPaymentError(locale === "bn" ? "নেটওয়ার্ক ত্রুটি" : "Network connection error");
    } finally {
      setPaymentLoading(false);
    }
  };

  const openEdit = () => {
    if (!customer) return;
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || "",
      notes: customer.notes || "",
      creditLimit: ((customer.creditLimitMinor || 0) / 100).toString(),
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
          creditLimitMinor: Math.max(0, Math.round((parseFloat(formData.creditLimit) || 0) * 100)),
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
      setEditError(locale === "bn" ? "নেটওয়ার্ক ত্রুটি" : "Network connection error");
    } finally {
      setEditLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
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

  const currentDue = balance?.currentDueMinor || 0;
  const creditLimit = balance?.creditLimitMinor ?? customer.creditLimitMinor ?? 0;
  const availableCredit = balance?.availableCreditMinor || 0;

  return (
    <div className="space-y-6">
      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-statement, #printable-statement * {
            visibility: visible;
          }
          #printable-statement {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 no-print">
        <div className="flex items-center gap-3">
          <Link href="/customers">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {strings.common.back}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {customer.name}
              </h1>
              {currentDue > 0 && (
                <Badge variant="destructive" className="bg-amber-600 hover:bg-amber-700 text-white text-xs">
                  {locale === "bn" ? "বকেয়া আছে" : "Has Due"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {customer.phone}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission("customer.payment") && (
            <Button
              size="sm"
              onClick={openCollectPayment}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <DollarSign className="h-4 w-4 mr-1.5" />
              {locale === "bn" ? "বাকি আদায়" : "Collect Due"}
            </Button>
          )}

          {hasPermission("customer.manage") && (
            <Button size="sm" variant="outline" onClick={openEdit}>
              <Edit2 className="h-4 w-4 mr-1.5" />
              {strings.customers.editCustomer}
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
        {/* Current Due */}
        <div className={`p-5 rounded-xl border shadow-xs ${
          currentDue > 0
            ? "bg-amber-500/10 border-amber-500/30 dark:bg-amber-950/20"
            : "bg-card border-border"
        }`}>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              {locale === "bn" ? "বর্তমান বাকি" : "Current Due"}
            </span>
            <AlertCircle className={`h-4 w-4 ${currentDue > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
          </div>
          <span className={`text-2xl font-bold font-mono tabular-nums ${currentDue > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
            {formatMoney(currentDue)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {currentDue > 0
              ? (locale === "bn" ? "অনতিবিলম্বে পরিশোধযোগ্য" : "Outstanding balance")
              : (locale === "bn" ? "কোন বকেয়া নেই" : "Clear balance")}
          </p>
        </div>

        {/* Credit Limit */}
        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{locale === "bn" ? "ক্রেডিট সীমা" : "Credit Limit"}</span>
            <CreditCard className="h-4 w-4 text-primary" />
          </div>
          <span className="text-2xl font-bold font-mono tabular-nums text-foreground">
            {formatMoney(creditLimit)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {locale === "bn" ? `অবশিষ্ট: ${formatMoney(availableCredit)}` : `Available: ${formatMoney(availableCredit)}`}
          </p>
        </div>

        {/* Total Purchases */}
        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{strings.customers.totalSpent}</span>
            <ShoppingBag className="h-4 w-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-bold font-mono tabular-nums text-foreground">
            {formatMoney(customer.totalSpentMinor || 0)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {customer.totalVisits || 0} {locale === "bn" ? "বার কেনাকাটা করেছেন" : "total purchases"}
          </p>
        </div>

        {/* Total Collected */}
        <div className="bg-card border border-border p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{locale === "bn" ? "মোট বাকি আদায়" : "Total Due Collected"}</span>
            <Receipt className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-2xl font-bold font-mono tabular-nums text-foreground">
            {formatMoney(balance?.totalCollectedMinor || 0)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {locale === "bn" ? "পূর্বে গৃহীত কিস্তি / পেমেন্ট" : "All-time payments"}
          </p>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="border-b border-border flex items-center justify-between no-print">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("statement")}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "statement"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>{locale === "bn" ? "লেজার ও হিসাব বিবরণী" : "Ledger & Statement"}</span>
          </button>

          <button
            onClick={() => setActiveTab("purchases")}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "purchases"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShoppingBag className="h-4 w-4" />
            <span>{strings.customers.purchaseHistory}</span>
          </button>
        </div>

        {activeTab === "statement" && (
          <Button variant="outline" size="sm" onClick={handlePrint} className="mb-2">
            <Printer className="h-4 w-4 mr-1.5" />
            <span>{locale === "bn" ? "স্টেটমেন্ট প্রিন্ট" : "Print Statement"}</span>
          </Button>
        )}
      </div>

      {/* Tab 1: Statement & Ledger */}
      {activeTab === "statement" && (
        <div id="printable-statement" className="space-y-4">
          {/* Statement Header / Filter (Hidden during print) */}
          <div className="bg-card border border-border p-4 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">{locale === "bn" ? "হতে:" : "From:"}</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">{locale === "bn" ? "পর্যন্ত:" : "To:"}</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>

              {(startDate || endDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="h-8 text-xs text-muted-foreground"
                >
                  {locale === "bn" ? "রিসেট" : "Reset"}
                </Button>
              )}
            </div>

            <div className="text-xs text-muted-foreground font-mono">
              {statement ? `${statement.items.length} ${locale === "bn" ? "টি লেনদেন" : "records"}` : ""}
            </div>
          </div>

          {/* Printable Header Info (Appears in Print) */}
          <div className="p-4 bg-muted/20 border border-border rounded-xl">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold text-foreground">{customer.name}</h2>
                <p className="text-xs text-muted-foreground font-mono">{customer.phone}</p>
                {customer.address && <p className="text-xs text-muted-foreground">{customer.address}</p>}
              </div>
              <div className="text-right">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {locale === "bn" ? "গ্রাহক লেজার বিবরণী" : "Customer Statement"}
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {startDate || endDate
                    ? `${startDate || "—"} to ${endDate || "Today"}`
                    : (locale === "bn" ? "সর্বমোট লেনদেন" : "All-time")}
                </p>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
              <div>
                <span className="text-muted-foreground">{locale === "bn" ? "পূর্ববর্তী বকেয়া: " : "Opening Balance: "}</span>
                <span className="font-mono font-bold text-foreground">
                  {formatMoney(statement?.openingBalanceMinor || 0)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{locale === "bn" ? "সর্বশেষ বকেয়া: " : "Closing Due: "}</span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                  {formatMoney(statement?.closingBalanceMinor || 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground font-semibold border-b border-border uppercase">
                  <tr>
                    <th className="py-2.5 px-3">{locale === "bn" ? "তারিখ ও সময়" : "Date & Time"}</th>
                    <th className="py-2.5 px-3">{locale === "bn" ? "ধরণ" : "Type"}</th>
                    <th className="py-2.5 px-3">{locale === "bn" ? "ভাউচার নং" : "Ref / Invoice"}</th>
                    <th className="py-2.5 px-3">{locale === "bn" ? "বিবরণ" : "Description"}</th>
                    <th className="py-2.5 px-3 text-right">{locale === "bn" ? "বাকি বৃদ্ধি (+)" : "Debit (+)"}</th>
                    <th className="py-2.5 px-3 text-right">{locale === "bn" ? "পরিশোধ (-)" : "Credit (-)"}</th>
                    <th className="py-2.5 px-3 text-right">{locale === "bn" ? "চলতি বকেয়া" : "Balance"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {statementLoading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                        {strings.common.loading}
                      </td>
                    </tr>
                  ) : !statement || statement.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        {locale === "bn" ? "কোন লেনদেনের রেকর্ড পাওয়া যায়নি" : "No transaction records found"}
                      </td>
                    </tr>
                  ) : (
                    statement.items.map((it) => {
                      const isSale = it.type === "sale";
                      const isPayment = it.type === "payment";
                      const isReturn = it.type === "return";

                      return (
                        <tr key={it.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 px-3 text-muted-foreground font-mono whitespace-nowrap">
                            {formatDateTime(it.date)}
                          </td>
                          <td className="py-2.5 px-3">
                            {isSale && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300 dark:border-amber-800 text-[10px]">
                                <ArrowUpRight className="h-3 w-3 mr-1" />
                                {locale === "bn" ? "বাকি বিক্রয়" : "Credit Sale"}
                              </Badge>
                            )}
                            {isPayment && (
                              <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:border-emerald-800 text-[10px]">
                                <ArrowDownLeft className="h-3 w-3 mr-1" />
                                {locale === "bn" ? "বাকি আদায়" : "Payment"}
                              </Badge>
                            )}
                            {isReturn && (
                              <Badge variant="outline" className="text-blue-700 border-blue-300 dark:border-blue-800 text-[10px]">
                                <RefreshCw className="h-3 w-3 mr-1" />
                                {locale === "bn" ? "ফেরত সমন্বয়" : "Return Credit"}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                            {isSale ? (
                              <Link href={`/sales/${it.id}`} className="hover:underline text-primary">
                                {it.reference}
                              </Link>
                            ) : (
                              it.reference
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground max-w-xs truncate">
                            {it.description || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                            {it.debitMinor > 0 ? formatMoney(it.debitMinor) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            {it.creditMinor > 0 ? formatMoney(it.creditMinor) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-foreground">
                            {formatMoney(it.runningBalanceMinor)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Purchases History */}
      {activeTab === "purchases" && (
        <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden no-print">
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
                        <td className="py-3 px-4 text-muted-foreground text-xs font-mono tabular-nums whitespace-nowrap">
                          {formatDateTime(s.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant={isVoided ? "destructive" : "secondary"} className="text-[10px]">
                            {formatSaleStatus(s.status, strings)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-foreground">
                          {formatMoney(s.totalMinor)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Link href={`/sales/${s.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs">
                              {strings.common.details}
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
      )}

      {/* Collect Due Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              <span>{locale === "bn" ? "গ্রাহকের বাকি আদায় / পেমেন্ট" : "Collect Customer Due Payment"}</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handlePaymentSubmit} className="space-y-4 py-2">
            {paymentSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{locale === "bn" ? "বাকি সফলভাবে আদায় করা হয়েছে!" : "Payment recorded successfully!"}</span>
              </div>
            )}

            {paymentError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            <div className="p-3 bg-muted/40 border border-border rounded-lg space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{locale === "bn" ? "গ্রাহক:" : "Customer:"}</span>
                <span className="font-semibold text-foreground">{customer.name} ({customer.phone})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{locale === "bn" ? "বর্তমান মোট বকেয়া:" : "Total Current Due:"}</span>
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{formatMoney(currentDue)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payAmount" className="text-xs font-semibold">
                {locale === "bn" ? "আদায়ের পরিমাণ (টাকা / ৳)" : "Payment Amount (৳)"} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="payAmount"
                type="number"
                min="1"
                step="any"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
                required
                className="h-10 text-base font-mono font-bold"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payMethod" className="text-xs font-semibold">
                {locale === "bn" ? "পরিশোধের মাধ্যম" : "Payment Method"} <span className="text-destructive">*</span>
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="payMethod" className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{locale === "bn" ? "ক্যাশ" : "Cash"}</SelectItem>
                  <SelectItem value="bkash">{locale === "bn" ? "বিকাশ" : "bKash"}</SelectItem>
                  <SelectItem value="nagad">{locale === "bn" ? "নগদ" : "Nagad"}</SelectItem>
                  <SelectItem value="rocket">{locale === "bn" ? "রকেট" : "Rocket"}</SelectItem>
                  <SelectItem value="card">{locale === "bn" ? "কার্ড" : "Card"}</SelectItem>
                  <SelectItem value="bank_transfer">{locale === "bn" ? "ব্যাংক ট্রান্সফার" : "Bank Transfer"}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payRef" className="text-xs font-semibold">
                {locale === "bn" ? "মানি রিসিট / রেফারেন্স নং" : "Reference / Receipt No."}
              </Label>
              <Input
                id="payRef"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="e.g. MR-2026-001"
                className="h-9 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payNotes" className="text-xs font-semibold">
                {locale === "bn" ? "মন্তব্য" : "Notes"}
              </Label>
              <Input
                id="payNotes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder={locale === "bn" ? "মন্তব্য লিখুন..." : "Notes..."}
                className="h-9 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowPaymentModal(false)}>
                {strings.common.cancel}
              </Button>
              <Button
                type="submit"
                disabled={paymentLoading || !paymentShiftId}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {paymentLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
                    {locale === "bn" ? "সংরক্ষণ হচ্ছে..." : "Recording..."}
                  </>
                ) : (
                  <span>{locale === "bn" ? "আদায় সম্পন্ন করুন" : "Confirm Payment"}</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {strings.customers.editCustomer}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{strings.customers.customerSaved}</span>
              </div>
            )}

            {editError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="editName" className="text-xs font-semibold">
                {strings.customers.name} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="editName"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                required
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editPhone" className="text-xs font-semibold">
                {strings.customers.phone} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="editPhone"
                value={formData.phone}
                onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                required
                className="h-9 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editCreditLimit" className="text-xs font-semibold">
                {locale === "bn" ? "ক্রেডিট সীমা (টাকা / ৳)" : "Credit Limit (৳)"}
              </Label>
              <Input
                id="editCreditLimit"
                type="number"
                min="0"
                step="any"
                value={formData.creditLimit}
                onChange={(e) => setFormData((f) => ({ ...f, creditLimit: e.target.value }))}
                placeholder="0"
                className="h-9 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editEmail" className="text-xs font-semibold">
                {strings.customers.email}
              </Label>
              <Input
                id="editEmail"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editAddr" className="text-xs font-semibold">
                {strings.customers.address}
              </Label>
              <Input
                id="editAddr"
                value={formData.address}
                onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editNotes" className="text-xs font-semibold">
                {strings.customers.notes}
              </Label>
              <Input
                id="editNotes"
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowEditModal(false)}>
                {strings.common.cancel}
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? strings.common.loading : strings.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
