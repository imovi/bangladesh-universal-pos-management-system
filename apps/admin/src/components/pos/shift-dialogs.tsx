"use client";

import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  X,
  Lock,
  Unlock,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  Loader2,
  Printer,
  CheckCircle,
} from "lucide-react";

// --- OPEN SHIFT DIALOG ---
interface OpenShiftDialogProps {
  isOpen: boolean;
  registerName: string;
  onOpenShift: (openingCashMinor: number, notes?: string) => Promise<void>;
  isSubmitting: boolean;
}

export function OpenShiftDialog({
  isOpen,
  registerName,
  onOpenShift,
  isSubmitting,
}: OpenShiftDialogProps) {
  const { strings, locale } = useTranslation();
  const [openingCashInput, setOpeningCashInput] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minor = Math.round(Number(openingCashInput || 0) * 100);
    await onOpenShift(minor, notes.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-shift-title"
        className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Unlock className="h-5 w-5" />
          </div>
          <div>
            <h2 id="open-shift-title" className="text-lg font-semibold tracking-tight">
              {strings.pos.openShift}
            </h2>
            <p className="text-xs text-muted-foreground">{registerName}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="opening-cash" className="text-xs font-medium">
              {strings.pos.openingCash} (৳)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">
                ৳
              </span>
              <Input
                id="opening-cash"
                type="number"
                min="0"
                step="any"
                value={openingCashInput}
                onChange={(e) => setOpeningCashInput(e.target.value)}
                placeholder={strings.pos.openingCashPlaceholder}
                className="pl-8 h-10 font-mono text-sm font-medium"
                data-testid="opening-cash-input"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="opening-notes" className="text-xs font-medium">
              {strings.pos.note} ({strings.common.optional})
            </Label>
            <Input
              id="opening-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={locale === "bn" ? "প্রারম্ভিক মন্তব্য..." : "Shift notes..."}
              className="h-10 text-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="submit"
              data-testid="confirm-open-shift-button"
              disabled={isSubmitting}
              className="w-full h-10 font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span>{strings.common.loading}</span>
                </>
              ) : (
                <span>{strings.pos.startShiftButton}</span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- SHIFT IN USE BLOCKING ALERT ---
interface ShiftInUseAlertProps {
  isOpen: boolean;
  registerName: string;
  cashierName: string;
  onSwitchRegister: () => void;
}

export function ShiftInUseAlert({
  isOpen,
  registerName,
  cashierName,
  onSwitchRegister,
}: ShiftInUseAlertProps) {
  const { strings, locale } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-card border border-rose-500/30 w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 text-center"
      >
        <div className="h-12 w-12 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-400">
            {strings.pos.shiftInUse}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {registerName} — {cashierName}
          </p>
          <p className="text-xs text-foreground mt-3 bg-muted p-3 rounded-lg leading-relaxed">
            {strings.pos.shiftInUseDetails}
          </p>
        </div>

        <div className="pt-2">
          <Button onClick={onSwitchRegister} data-testid="switch-register-btn" className="w-full h-10 font-medium">
            {locale === "bn" ? "অন্য রেজিস্টার বেছে নিন" : "Choose Another Register"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- CASH IN / OUT DIALOG ---
interface CashMovementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitMovement: (type: "cash_in" | "cash_out", amountMinor: number, reason: string) => Promise<void>;
  isSubmitting: boolean;
}

export function CashMovementDialog({
  isOpen,
  onClose,
  onSubmitMovement,
  isSubmitting,
}: CashMovementDialogProps) {
  const { strings, locale } = useTranslation();
  const [type, setType] = useState<"cash_in" | "cash_out">("cash_in");
  const [amountInput, setAmountInput] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const num = Number(amountInput);
    if (!num || num <= 0) {
      setError(locale === "bn" ? "সঠিক টাকার পরিমাণ দিন" : "Valid amount required");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError(strings.pos.cashReasonRequired);
      return;
    }

    const minor = Math.round(num * 100);
    await onSubmitMovement(type, minor, reason.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-movement-title"
        className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {type === "cash_in" ? (
              <ArrowDownCircle className="h-5 w-5 text-emerald-600" />
            ) : (
              <ArrowUpCircle className="h-5 w-5 text-rose-600" />
            )}
            <h2 id="cash-movement-title" className="text-lg font-semibold tracking-tight">
              {strings.pos.cashManagement}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Toggle Type */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
          <Button
            type="button"
            variant={type === "cash_in" ? "default" : "ghost"}
            size="sm"
            onClick={() => setType("cash_in")}
            className="text-xs font-semibold"
          >
            {strings.pos.cashIn}
          </Button>
          <Button
            type="button"
            variant={type === "cash_out" ? "default" : "ghost"}
            size="sm"
            onClick={() => setType("cash_out")}
            className="text-xs font-semibold"
          >
            {strings.pos.cashOut}
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cash-amount" className="text-xs font-medium">
              {strings.pos.cashAmount} (৳)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">
                ৳
              </span>
              <Input
                id="cash-amount"
                type="number"
                min="0"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="pl-8 h-10 font-mono text-sm font-medium"
                data-testid="cash-movement-amount-input"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cash-reason" className="text-xs font-medium">
              {strings.pos.cashReason} *
            </Label>
            <Input
              id="cash-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={locale === "bn" ? "কারণ উল্লেখ করুন (বাধ্যতামূলক)..." : "Mandatory reason..."}
              className="h-10 text-xs"
              data-testid="cash-movement-reason-input"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              {strings.common.cancel}
            </Button>
            <Button
              type="submit"
              data-testid="confirm-cash-movement-button"
              disabled={isSubmitting}
              className="h-10 font-semibold"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span>{strings.common.save}</span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- CLOSE SHIFT DIALOG ---
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

interface CloseShiftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shiftData: any;
  onConfirmClose: (countedCashMinor: number, notes?: string) => Promise<any>;
  isSubmitting: boolean;
}

export function CloseShiftDialog({
  isOpen,
  onClose,
  shiftData,
  onConfirmClose,
  isSubmitting,
}: CloseShiftDialogProps) {
  const { strings, locale } = useTranslation();
  const [denominations, setDenominations] = useState<Record<number, number>>({});
  const [directCountedCash, setDirectCountedCash] = useState<string>("");
  const [showDenomCounter, setShowDenomCounter] = useState(false);
  const [notes, setNotes] = useState("");
  const [closedSummary, setClosedSummary] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Calculate denom sum
  const denomSumMinor = Object.entries(denominations).reduce(
    (sum, [denom, count]) => sum + Number(denom) * (Number(count) || 0) * 100,
    0,
  );

  const countedCashMinor = showDenomCounter
    ? denomSumMinor
    : Math.round(Number(directCountedCash || 0) * 100);

  const expectedCashMinor = shiftData?.summary?.expectedCashMinor ?? 0;
  const differenceMinor = countedCashMinor - expectedCashMinor;

  const handleDenomChange = (denom: number, count: number) => {
    setDenominations((prev) => ({
      ...prev,
      [denom]: Math.max(0, count || 0),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      const result = await onConfirmClose(countedCashMinor, notes.trim() || undefined);
      if (result) {
        setClosedSummary(result);
      } else {
        setErrorMessage(
          locale === "bn"
            ? "শিফট বন্ধ করা যায়নি। সার্ভার থেকে কোনো সাড়া মেলেনি বা শিফটটি ইতোমধ্যে বন্ধ রয়েছে।"
            : "Failed to close shift. The shift may already be closed."
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || (locale === "bn" ? "শিফট বন্ধ করা সম্ভব হয়নি" : "Failed to close shift"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-shift-title"
        className="bg-card border border-border w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h2 id="close-shift-title" className="text-lg font-semibold tracking-tight">
                {strings.pos.closeShift}
              </h2>
              <p className="text-xs text-muted-foreground">{strings.pos.closeShiftConfirm}</p>
            </div>
          </div>
          {!closedSummary && (
            <Button variant="ghost" size="icon" onClick={() => { setClosedSummary(null); onClose(); }} className="h-8 w-8 rounded-full">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {closedSummary ? (
            /* Summary after closing */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 shrink-0" />
                <div>
                  <h4 data-testid="shift-closed-success-title" className="font-semibold text-sm">{strings.pos.shiftClosed}</h4>
                  <p className="text-xs">{strings.pos.shiftSummary}</p>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-muted/40 rounded-xl border border-border text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{strings.pos.expectedCash}:</span>
                  <span className="font-semibold">{formatMoney(closedSummary.expectedCashMinor)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{strings.pos.countedCash}:</span>
                  <span className="font-semibold">{formatMoney(closedSummary.closingCashMinor)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-border pt-1">
                  <span>{strings.pos.difference}:</span>
                  <span
                    className={
                      closedSummary.cashDifferenceMinor < 0
                        ? "text-rose-600"
                        : closedSummary.cashDifferenceMinor > 0
                        ? "text-emerald-600"
                        : "text-foreground"
                    }
                  >
                    {formatMoney(closedSummary.cashDifferenceMinor)}
                  </span>
                </div>

                {closedSummary.paymentMethodTotalsMinor && (
                  <div className="pt-2 border-t border-border space-y-1">
                    <span className="font-sans font-semibold text-foreground block">
                      {locale === "bn" ? "পেমেন্ট মাধ্যম অনুপাত:" : "Payment Method Totals:"}
                    </span>
                    {Object.entries(closedSummary.paymentMethodTotalsMinor).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="capitalize">{k}:</span>
                        <span>{formatMoney(Number(v))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => window.print()}
                  variant="outline"
                  className="flex-1 flex items-center justify-center gap-2 h-10"
                >
                  <Printer className="h-4 w-4" />
                  <span>{strings.pos.printShiftSummary}</span>
                </Button>
                <Button
                  onClick={() => {
                    setClosedSummary(null);
                    onClose();
                  }}
                  data-testid="done-close-shift-btn"
                  className="flex-1 h-10 font-semibold"
                >
                  {locale === "bn" ? "ঠিক আছে" : "Done"}
                </Button>
              </div>
            </div>
          ) : (
            /* Close form before closing */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Expected Cash Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-muted/40 rounded-xl border border-border">
                <div>
                  <span className="text-xs text-muted-foreground">{strings.pos.expectedCash}</span>
                  <div className="text-lg font-bold font-mono text-primary">
                    {formatMoney(expectedCashMinor)}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{strings.pos.countedCash}</span>
                  <div className="text-lg font-bold font-mono">
                    {formatMoney(countedCashMinor)}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-xs text-muted-foreground">{strings.pos.difference}</span>
                  <div
                    className={`text-lg font-bold font-mono ${
                      differenceMinor < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : differenceMinor > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground"
                    }`}
                  >
                    {formatMoney(differenceMinor)}
                  </div>
                </div>
              </div>

              {/* Denomination Counter Toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="direct-cash-input" className="text-xs font-semibold">
                  {strings.pos.countedCash} (৳)
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDenomCounter(!showDenomCounter)}
                  className="text-xs h-7 text-primary hover:text-primary/80"
                >
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  {showDenomCounter
                    ? locale === "bn"
                      ? "সাধারণ ইনপুট"
                      : "Direct Input"
                    : strings.pos.denominationCounter}
                </Button>
              </div>

              {showDenomCounter ? (
                /* Denomination Note Counter Grid */
                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/20 border border-border rounded-xl max-h-60 overflow-y-auto">
                  {DENOMINATIONS.map((denom) => (
                    <div key={denom} className="flex items-center gap-2">
                      <span className="w-12 text-xs font-mono font-bold text-muted-foreground">
                        ৳{denom}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        value={denominations[denom] || ""}
                        onChange={(e) => handleDenomChange(denom, parseInt(e.target.value, 10) || 0)}
                        placeholder="0"
                        className="h-8 text-xs font-mono"
                        data-testid={`denom-input-${denom}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                /* Direct Amount Input */
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">
                    ৳
                  </span>
                  <Input
                    id="direct-cash-input"
                    type="number"
                    min="0"
                    step="any"
                    value={directCountedCash}
                    onChange={(e) => setDirectCountedCash(e.target.value)}
                    placeholder="0.00"
                    className="pl-8 h-10 font-mono text-sm font-medium"
                    data-testid="counted-cash-input"
                    autoFocus
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="close-notes" className="text-xs font-medium">
                  {strings.pos.note} ({strings.common.optional})
                </Label>
                <Input
                  id="close-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={locale === "bn" ? "শিফট সমাপ্তির মন্তব্য..." : "Closing notes..."}
                  className="h-10 text-xs"
                />
              </div>

              {errorMessage && (
                <div className="p-3 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-lg">
                  {errorMessage}
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex justify-end gap-2 border-t border-border">
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                  {strings.common.cancel}
                </Button>
                <Button
                  type="submit"
                  data-testid="confirm-close-shift-button"
                  disabled={isSubmitting}
                  className="h-10 px-6 font-semibold bg-rose-600 hover:bg-rose-700 text-white"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span>{strings.common.loading}</span>
                    </>
                  ) : (
                    <span>{strings.pos.closeShift}</span>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
