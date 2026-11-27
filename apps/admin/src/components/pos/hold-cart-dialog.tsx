"use client";

import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HeldCart, StoredCart } from "@/lib/pos/pos-storage";
import { X, PauseCircle, PlayCircle, Trash2, Clock } from "lucide-react";

interface HoldCartDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeCart: StoredCart;
  heldCarts: HeldCart[];
  onHoldCurrentCart: (label: string) => void;
  onResumeCart: (heldCart: HeldCart) => void;
  onRemoveHeldCart: (heldCartId: string) => void;
}

export function HoldCartDialog({
  isOpen,
  onClose,
  activeCart,
  heldCarts,
  onHoldCurrentCart,
  onResumeCart,
  onRemoveHeldCart,
}: HoldCartDialogProps) {
  const { strings, locale } = useTranslation();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasItemsToHold = activeCart.items && activeCart.items.length > 0;

  const handleHold = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!hasItemsToHold) {
      setError(locale === "bn" ? "কার্টে পণ্য থাকতে হবে" : "Cart is empty");
      return;
    }
    if (heldCarts.length >= 10) {
      setError(locale === "bn" ? "সর্বোচ্চ ১০টি কার্ট হোল্ড করা যায়" : "Max 10 held carts reached");
      return;
    }
    const finalLabel = label.trim() || `${locale === "bn" ? "কার্ট #" : "Cart #"}${heldCarts.length + 1}`;
    onHoldCurrentCart(finalLabel);
    setLabel("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hold-cart-title"
        className="bg-card text-card-foreground border border-border w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-primary" />
            <h2 id="hold-cart-title" className="text-base font-semibold tracking-tight">
              {strings.pos.holdCart} / {strings.pos.resumeCart}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Hold Active Cart Form */}
          {hasItemsToHold && (
            <form onSubmit={handleHold} className="p-4 bg-muted/30 border border-border rounded-xl space-y-3">
              <Label htmlFor="hold-label-input" className="text-xs font-semibold block">
                {strings.pos.holdCart} ({activeCart.items.length} {locale === "bn" ? "আইটেম" : "items"})
              </Label>
              <div className="flex gap-2">
                <Input
                  id="hold-label-input"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={strings.pos.holdLabel}
                  className="h-9 text-xs"
                  data-testid="hold-cart-label-input"
                />
                <Button
                  type="submit"
                  size="sm"
                  data-testid="confirm-hold-cart-button"
                  className="h-9 px-4 font-semibold text-xs shrink-0"
                >
                  <PauseCircle className="h-3.5 w-3.5 mr-1" />
                  {strings.pos.holdCart}
                </Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          )}

          {/* Held Carts List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {strings.pos.resumeCart} ({heldCarts.length}/10)
              </Label>
            </div>

            {heldCarts.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground bg-muted/20 border border-dashed border-border rounded-xl">
                {strings.pos.noHeldCarts}
              </div>
            ) : (
              <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
                {heldCarts.map((hc) => {
                  const totalItems = hc.items.reduce((s, it) => s + it.quantity, 0);
                  const approxTotal = hc.items.reduce(
                    (s, it) => s + it.quantity * it.unitPriceMinor,
                    0,
                  );

                  return (
                    <div
                      key={hc.id}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs truncate">{hc.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {hc.items.map((it) => `${it.quantity}${it.unitName && it.unitName.toLowerCase() !== "pcs" && it.unitName !== "পিস" ? ` ${it.unitName}` : ""} × ${it.name}`).join(", ")}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono mt-0.5">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(hc.heldAt).toLocaleTimeString()}</span>
                          <span>•</span>
                          <span>
                            {totalItems} {locale === "bn" ? "আইটেম" : "items"}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-foreground">
                            {formatMoney(approxTotal)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onResumeCart(hc);
                            onClose();
                          }}
                          className="h-8 px-2.5 text-xs font-medium"
                          data-testid={`resume-cart-${hc.id}`}
                        >
                          <PlayCircle className="h-3.5 w-3.5 mr-1 text-primary" />
                          {locale === "bn" ? "চালু করুন" : "Resume"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => onRemoveHeldCart(hc.id)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
