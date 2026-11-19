"use client";

import React, { useState } from "react";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Search,
  Printer,
  Ban,
  Receipt,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface ShiftSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  sales: any[];
  canVoid: boolean;
  onReprintReceipt: (sale: any) => void;
  onVoidSale: (saleId: string, reason: string) => Promise<boolean>;
  timezone?: string;
}

export function ShiftSalesModal({
  isOpen,
  onClose,
  sales,
  canVoid,
  onReprintReceipt,
  onVoidSale,
  timezone = "Asia/Dhaka",
}: ShiftSalesModalProps) {
  const { strings, locale } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSaleForVoid, setSelectedSaleForVoid] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredSales = sales.filter((s) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      s.invoiceNumber?.toLowerCase().includes(term) ||
      s.customer?.name?.toLowerCase().includes(term) ||
      s.customer?.phone?.includes(term)
    );
  });

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoidError(null);
    if (!voidReason.trim() || voidReason.trim().length < 3) {
      setVoidError(strings.pos.voidReasonRequired);
      return;
    }

    setIsVoiding(true);
    const success = await onVoidSale(selectedSaleForVoid.id, voidReason.trim());
    setIsVoiding(false);
    if (success) {
      setSelectedSaleForVoid(null);
      setVoidReason("");
    } else {
      setVoidError(strings.pos.voidFailed);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-sales-title"
        data-testid="shift-sales-modal"
        className="bg-card text-card-foreground border border-border w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2.5">
            <Receipt className="h-5 w-5 text-primary" />
            <div>
              <h2 id="shift-sales-title" className="text-base font-semibold tracking-tight">
                {strings.pos.currentShiftSales}
              </h2>
              <p className="text-xs text-muted-foreground font-mono">
                {sales.length} {strings.pos.salesCount}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border bg-card">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={strings.common.search}
              className="pl-9 h-9 text-xs font-mono"
            />
          </div>
        </div>

        {/* Table / List */}
        <div className="p-4 overflow-y-auto flex-1">
          {filteredSales.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              {strings.common.noData}
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
              {filteredSales.map((s) => {
                const isCompleted = s.status === "completed";
                const isUnsynced = Boolean(s.isUnsynced);
                return (
                  <div
                    key={s.id}
                    data-testid={`shift-sale-row-${s.invoiceNumber}`}
                    className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs sm:text-sm font-mono text-primary">
                          {s.invoiceNumber}
                        </span>
                        {isUnsynced ? (
                          <Badge
                            variant="outline"
                            data-testid={`shift-sale-badge-${s.invoiceNumber}`}
                            className="text-[10px] py-0 px-2 font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                          >
                            {locale === "bn" ? "সিঙ্ক হয়নি" : "Unsynced"}
                          </Badge>
                        ) : (
                          <Badge
                            variant={isCompleted ? "default" : "destructive"}
                            data-testid={`shift-sale-badge-${s.invoiceNumber}`}
                            className="text-[10px] py-0 px-2 font-medium"
                          >
                            {isCompleted
                              ? locale === "bn"
                                ? "সম্পন্ন"
                                : "Completed"
                              : locale === "bn"
                              ? "বাতিল"
                              : "Voided"}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                        <span>{formatDateTime(s.createdAt, timezone)}</span>
                        <span>•</span>
                        <span>{s.customer?.name || strings.pos.walkInCustomer}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-right">
                        <div className="font-bold text-sm font-mono tabular-nums">
                          {formatMoney(s.totalMinor)}
                        </div>
                        <div className="text-[11px] text-muted-foreground capitalize">
                          {s.payments?.[0]?.paymentMethod || "cash"}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`reprint-sale-btn-${s.invoiceNumber}`}
                          onClick={() => onReprintReceipt(s)}
                          className="h-8 px-2.5 text-xs font-medium"
                          title={strings.pos.reprint}
                        >
                          <Printer className="h-3.5 w-3.5 mr-1" />
                          <span>{strings.pos.reprint}</span>
                        </Button>

                        {!isUnsynced && canVoid && isCompleted && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedSaleForVoid(s)}
                            className="h-8 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                            title={strings.pos.voidSale}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            <span>{strings.pos.voidSale}</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Void Reason Modal Overlay */}
        {selectedSaleForVoid && (
          <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in"
            >
              <div className="flex items-center gap-2.5 text-rose-600">
                <AlertCircle className="h-5 w-5" />
                <h3 className="font-semibold text-base">{strings.pos.voidSale}</h3>
              </div>

              <p className="text-xs text-muted-foreground">
                {strings.pos.voidPrompt} {selectedSaleForVoid.invoiceNumber}
              </p>

              <form onSubmit={handleConfirmVoid} className="space-y-4">
                <Input
                  type="text"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder={strings.pos.mandatoryVoidReason}
                  className="h-10 text-xs"
                  data-testid="void-reason-input"
                  autoFocus
                />

                {voidError && <p className="text-xs text-destructive">{voidError}</p>}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedSaleForVoid(null);
                      setVoidReason("");
                    }}
                    disabled={isVoiding}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button
                    type="submit"
                    data-testid="confirm-void-button"
                    disabled={isVoiding}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                  >
                    {isVoiding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span>{strings.pos.voidSale}</span>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
