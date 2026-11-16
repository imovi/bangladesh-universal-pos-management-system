"use client";

import React, { useState, useEffect } from "react";
import { formatMoney } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PaymentItemInput,
  calculatePaymentChange,
} from "@/lib/pos/cart-calculations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X,
  CreditCard,
  Banknote,
  Smartphone,
  Building,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  totalPayableMinor: number;
  onCompleteSale: (payments: PaymentItemInput[], refundMethod?: string) => Promise<void>;
  isSubmitting: boolean;
  isExchange?: boolean;
  customer?: { id: string; name: string; phone: string; creditLimitMinor?: number } | null;
  canSellCredit?: boolean;
  customerDueMinor?: number;
}

const PAYMENT_METHODS = [
  { id: "cash", labelBn: "ক্যাশ", labelEn: "Cash", icon: Banknote },
  { id: "bkash", labelBn: "বিকাশ", labelEn: "bKash", icon: Smartphone },
  { id: "nagad", labelBn: "নগদ", labelEn: "Nagad", icon: Smartphone },
  { id: "rocket", labelBn: "রকেট", labelEn: "Rocket", icon: Smartphone },
  { id: "card", labelBn: "কার্ড", labelEn: "Card", icon: CreditCard },
  { id: "bank_transfer", labelBn: "ব্যাংক", labelEn: "Bank", icon: Building },
] as const;

export function PaymentDialog({
  isOpen,
  onClose,
  totalPayableMinor,
  onCompleteSale,
  isSubmitting,
  isExchange,
  customer,
  canSellCredit,
  customerDueMinor,
}: PaymentDialogProps) {
  const { strings, locale } = useTranslation();
  const [exchangeRefundMethod, setExchangeRefundMethod] = useState<string>("cash");

  // Active payment entries
  const [payments, setPayments] = useState<PaymentItemInput[]>([
    { paymentMethod: "cash", amountMinor: Math.max(0, totalPayableMinor) },
  ]);

  useEffect(() => {
    if (isOpen) {
      setPayments([{ paymentMethod: "cash", amountMinor: Math.max(0, totalPayableMinor) }]);
    }
  }, [isOpen, totalPayableMinor]);

  if (!isOpen) return null;

  const isExchangeRefund = Boolean(isExchange && totalPayableMinor < 0);
  const isExchangeEven = Boolean(isExchange && totalPayableMinor === 0);

  const calculation =
    isExchangeRefund || isExchangeEven
      ? {
          totalPaidMinor: 0,
          cashPaidMinor: 0,
          nonCashPaidMinor: 0,
          balanceDueMinor: 0,
          changeDueMinor: 0,
          isCovered: true,
          isValid: true,
          errorMessage: null,
        }
      : calculatePaymentChange(totalPayableMinor, payments);

  const handleUpdatePayment = (index: number, updates: Partial<PaymentItemInput>) => {
    setPayments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleAddMethod = (method: PaymentItemInput["paymentMethod"]) => {
    const remainingDue = calculation.balanceDueMinor;
    setPayments((prev) => [
      ...prev,
      { paymentMethod: method, amountMinor: remainingDue > 0 ? remainingDue : 0 },
    ]);
  };

  const handleRemovePayment = (index: number) => {
    if (payments.length <= 1) return;
    setPayments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleQuickCash = (amount: number) => {
    const minor = Math.round(amount * 100);

    // Update the first cash payment or add one
    setPayments((prev) => {
      const cashIdx = prev.findIndex((p) => p.paymentMethod === "cash");
      if (cashIdx >= 0) {
        const next = [...prev];
        next[cashIdx] = { ...next[cashIdx], amountMinor: minor };
        return next;
      }
      return [...prev, { paymentMethod: "cash", amountMinor: minor }];
    });
  };

  // Quick cash options
  const payableTaka = Math.ceil(totalPayableMinor / 100);
  const next500 = Math.ceil(payableTaka / 500) * 500 || 500;
  const next1000 = Math.ceil(payableTaka / 1000) * 1000 || 1000;

  const quickButtons = [
    { label: `${strings.pos.exactAmount} (৳${payableTaka})`, val: payableTaka },
    { label: "৳500", val: 500 },
    { label: "৳1000", val: 1000 },
    ...(next500 !== payableTaka && next500 !== 500 && next500 !== 1000
      ? [{ label: `৳${next500}`, val: next500 }]
      : []),
    ...(next1000 !== payableTaka && next1000 !== 1000 && next1000 !== next500
      ? [{ label: `৳${next1000}`, val: next1000 }]
      : []),
  ];

  const isCreditAllowed = Boolean(customer && canSellCredit);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isExchangeRefund || isExchangeEven) {
      await onCompleteSale([], exchangeRefundMethod);
      return;
    }
    const validPayments = payments.filter((p) => p.amountMinor > 0);
    if (!isCreditAllowed) {
      if (!calculation.isCovered || !calculation.isValid || isSubmitting || validPayments.length === 0) return;
    } else {
      if (!calculation.isValid || isSubmitting) return;
    }
    await onCompleteSale(validPayments);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="bg-card text-card-foreground border border-border w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div>
            <h2 id="payment-dialog-title" className="text-lg font-semibold tracking-tight">
              {strings.pos.paymentTitle}
            </h2>
            <p className="text-xs text-muted-foreground">{strings.pos.splitPayment}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Due & Change / Refund Banner */}
          <div className="p-4 rounded-xl bg-muted/40 border border-border">
            {isExchangeRefund ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold text-amber-900 dark:text-amber-200 block">
                    {locale === "bn" ? "পণ্য বদল: গ্রাহককে ফেরত প্রদেয় অর্থ" : "Exchange: Refund Due to Customer"}
                  </span>
                  <div className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400 font-mono">
                    -{formatMoney(-totalPayableMinor)}
                  </div>
                </div>
                <div className="w-full sm:w-48">
                  <label className="text-[11px] text-muted-foreground block mb-1 font-medium">
                    {locale === "bn" ? "রিফান্ড মাধ্যম:" : "Refund Method:"}
                  </label>
                  <Select value={exchangeRefundMethod} onValueChange={setExchangeRefundMethod}>
                    <SelectTrigger className="h-9 text-xs bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{locale === "bn" ? "ক্যাশ" : "Cash"}</SelectItem>
                      <SelectItem value="card">{locale === "bn" ? "কার্ড" : "Card"}</SelectItem>
                      <SelectItem value="bkash">{locale === "bn" ? "বিকাশ" : "bKash"}</SelectItem>
                      <SelectItem value="nagad">{locale === "bn" ? "নগদ" : "Nagad"}</SelectItem>
                      <SelectItem value="other">{locale === "bn" ? "অন্যান্য" : "Other"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : isExchangeEven ? (
              <div className="text-center py-2">
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 block">
                  {locale === "bn" ? "সমান মূল্যের বদল (Even Exchange)" : "Even Value Exchange"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {locale === "bn" ? "কোন অর্থ আদান-প্রদান প্রয়োজন নেই" : "No payment or refund required"}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">{strings.pos.payable}</span>
                  <div className="text-2xl font-bold tabular-nums text-primary font-mono">
                    {formatMoney(totalPayableMinor)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium text-muted-foreground">
                    {calculation.isCovered ? strings.pos.change : strings.pos.due}
                  </span>
                  <div
                    className={`text-2xl font-bold tabular-nums font-mono ${
                      calculation.isCovered
                        ? calculation.changeDueMinor > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-foreground"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {formatMoney(calculation.isCovered ? calculation.changeDueMinor : calculation.balanceDueMinor)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isExchangeRefund && !isExchangeEven && (
            <>
              {/* Quick Cash Buttons */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block font-medium">
                  {locale === "bn" ? "দ্রুত ক্যাশ নির্বাচন:" : "Quick cash tender:"}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {quickButtons.map((qb, i) => (
                    <Button
                      key={i}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickCash(qb.val)}
                      className="h-8 text-xs font-mono font-medium"
                    >
                      {qb.label}
                    </Button>
                  ))}
                </div>
              </div>

          {/* Payment Method Rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">{strings.pos.splitPayment}</Label>
            </div>

            {payments.map((p, idx) => {
              const isCash = p.paymentMethod === "cash";
              return (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-border bg-card flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="w-full sm:w-40 shrink-0">
                    <Select
                      value={p.paymentMethod}
                      onValueChange={(val) =>
                        handleUpdatePayment(idx, {
                          paymentMethod: val as PaymentItemInput["paymentMethod"],
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={locale === "bn" ? "পেমেন্ট মাধ্যম" : "Payment Method"}
                        className="w-full h-9 text-xs font-medium"
                        data-testid={`payment-method-select-${idx}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-xs">
                            {locale === "bn" ? m.labelBn : m.labelEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-2 text-xs font-semibold text-muted-foreground">
                        ৳
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={p.amountMinor ? p.amountMinor / 100 : ""}
                        onChange={(e) =>
                          handleUpdatePayment(idx, {
                            amountMinor: Math.round(Number(e.target.value) * 100) || 0,
                          })
                        }
                        aria-label={strings.pos.amountTendered}
                        placeholder={strings.pos.amountTendered}
                        className="pl-7 h-9 text-xs font-mono font-medium"
                        data-testid={`payment-amount-input-${idx}`}
                      />
                    </div>

                    {!isCash && (
                      <Input
                        type="text"
                        value={p.reference || ""}
                        onChange={(e) => handleUpdatePayment(idx, { reference: e.target.value })}
                        aria-label={strings.pos.reference}
                        placeholder={strings.pos.reference}
                        className="w-32 sm:w-40 h-9 text-xs"
                        data-testid={`payment-ref-input-${idx}`}
                      />
                    )}

                    {payments.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemovePayment(idx)}
                        aria-label={locale === "bn" ? "পেমেন্ট মাধ্যম মুছুন" : "Remove payment method"}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add Payment Method Button */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PAYMENT_METHODS.map((m) => (
                <Button
                  key={m.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAddMethod(m.id as any)}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {locale === "bn" ? m.labelBn : m.labelEn}
                </Button>
              ))}
            </div>
          </div>

          {/* Validation Warnings */}
          {!calculation.isValid && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{calculation.errorMessage}</span>
            </div>
          )}

          {!calculation.isCovered && calculation.balanceDueMinor > 0 && !isCreditAllowed && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {locale === "bn"
                  ? `সম্পূর্ণ পেমেন্ট প্রয়োজন। এখনো বাকি: ৳${(calculation.balanceDueMinor / 100).toFixed(2)}`
                  : `Full payment required. Remaining due: ৳${(calculation.balanceDueMinor / 100).toFixed(2)}`}
              </span>
            </div>
          )}

          {!calculation.isCovered && calculation.balanceDueMinor > 0 && isCreditAllowed && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" />
                  {locale === "bn" ? "ধারে / বাকিতে বিক্রি (Credit Sale)" : "Sale on Credit (Baki)"}
                </span>
                <span className="font-bold text-amber-800 dark:text-amber-300 font-mono text-sm">
                  {formatMoney(calculation.balanceDueMinor)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-amber-500/20">
                <div>
                  <span>{locale === "bn" ? "পূর্ববর্তী বাকি:" : "Current Due:"} </span>
                  <span className="font-mono font-semibold text-foreground">{formatMoney(customerDueMinor || 0)}</span>
                </div>
                <div className="text-right">
                  <span>{locale === "bn" ? "ক্রেডিট সীমা:" : "Credit Limit:"} </span>
                  <span className="font-mono font-semibold text-foreground">{formatMoney(customer?.creditLimitMinor || 0)}</span>
                </div>
                <div className="col-span-2 flex justify-between font-medium">
                  <span>{locale === "bn" ? "এই বিক্রির পর মোট বকেয়া হবে:" : "Total due after this sale:"} </span>
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                    {formatMoney((customerDueMinor || 0) + calculation.balanceDueMinor)}
                  </span>
                </div>
              </div>
              {(customerDueMinor || 0) + calculation.balanceDueMinor > (customer?.creditLimitMinor || 0) && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                  ⚠️ {locale === "bn" ? "সতর্কতা: এটি গ্রাহকের অনুমোদিত ক্রেডিট সীমা অতিক্রম করছে (অনুমোদনের প্রয়োজন হতে পারে)" : "Warning: This exceeds the customer's credit limit (override required)"}
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {strings.common.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            data-testid="confirm-payment-button"
            disabled={(!calculation.isCovered && !isCreditAllowed) || !calculation.isValid || isSubmitting}
            className={`px-6 h-10 font-semibold ${
              !calculation.isCovered && isCreditAllowed ? "bg-amber-600 hover:bg-amber-700 text-white" : ""
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span>{strings.common.loading}</span>
              </>
            ) : !calculation.isCovered && isCreditAllowed ? (
              <span>{locale === "bn" ? "বাকি বিক্রয় সম্পন্ন করুন" : "Complete Credit Sale"}</span>
            ) : (
              <span>{strings.pos.completeSale}</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
