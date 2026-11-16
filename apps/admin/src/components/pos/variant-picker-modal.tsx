"use client";

import React from "react";
import { formatMoney } from "@/lib/utils";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { X, Layers } from "lucide-react";

interface VariantPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: any;
  branchId: string;
  onSelectVariant: (variant: any, product: any) => void;
}

export function VariantPickerModal({
  isOpen,
  onClose,
  product,
  branchId,
  onSelectVariant,
}: VariantPickerModalProps) {
  const { locale } = useTranslation();

  if (!isOpen || !product || !product.variants || product.variants.length === 0) {
    return null;
  }

  // Extract sizes and colors
  const sizeSet = new Set<string>();
  const colorSet = new Set<string>();
  const matrixMap = new Map<string, any>();

  for (const v of product.variants) {
    let size = "Default";
    let color = "Standard";

    if (v.optionValues && Array.isArray(v.optionValues)) {
      for (const ov of v.optionValues) {
        const optName = ov.optionValue?.option?.name?.toLowerCase();
        const val = ov.optionValue?.value;
        if (optName === "size") size = val;
        else if (optName === "color" || optName === "colour") color = val;
      }
    }

    sizeSet.add(size);
    colorSet.add(color);

    // Compute branch stock
    let stock = 0;
    if (Array.isArray(v.stockLevels)) {
      const sl = v.stockLevels.find((s: any) => s.branchId === branchId);
      stock = sl ? Number(sl.quantity) : 0;
    }

    matrixMap.set(`${color}:${size}`, { variant: v, stock, size, color });
  }

  const sizes = Array.from(sizeSet);
  const colors = Array.from(colorSet);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-picker-title"
        className="bg-card text-card-foreground border border-border w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-primary" />
            <div>
              <h2 id="variant-picker-title" className="text-base font-semibold tracking-tight">
                {product.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {locale === "bn"
                  ? "সাইজ এবং রং বেছে নিন (স্টক অনুযায়ী)"
                  : "Choose size and colour variant"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={locale === "bn" ? "বন্ধ করুন" : "Close"}
            className="h-8 w-8 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Matrix Grid */}
        <div className="p-6 overflow-auto flex-1">
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 border-b border-border">
                <tr>
                  <th className="p-3 text-left font-semibold text-muted-foreground w-28">
                    {locale === "bn" ? "রং / সাইজ" : "Colour \\ Size"}
                  </th>
                  {sizes.map((s) => (
                    <th key={s} className="p-3 text-center font-semibold text-foreground">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {colors.map((color) => (
                  <tr key={color} className="hover:bg-muted/20">
                    <td className="p-3 font-semibold text-foreground bg-muted/30">{color}</td>
                    {sizes.map((size) => {
                      const item = matrixMap.get(`${color}:${size}`);
                      if (!item) {
                        return (
                          <td key={size} className="p-2 text-center text-muted-foreground/40">
                            —
                          </td>
                        );
                      }

                      const isOutOfStock = item.stock <= 0;
                      return (
                        <td key={size} className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectVariant(item.variant, product);
                              onClose();
                            }}
                            data-testid={`variant-cell-${color}-${size}`}
                            className={`w-full min-h-[52px] p-2 rounded-lg border text-xs font-mono transition-all flex flex-col items-center justify-center gap-0.5 ${
                              isOutOfStock
                                ? "bg-muted/40 border-dashed border-border text-muted-foreground opacity-60 hover:opacity-100"
                                : "bg-card border-border hover:border-primary hover:bg-primary/5 text-foreground shadow-xs active:scale-95"
                            }`}
                          >
                            <span className="font-semibold">{formatMoney(item.variant.priceMinor)}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded ${
                                isOutOfStock
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-700 dark:text-emerald-400 font-medium"
                              }`}
                            >
                              {isOutOfStock
                                ? locale === "bn"
                                  ? "স্টক নেই"
                                  : "Out of stock"
                                : `${locale === "bn" ? "স্টক:" : "Stock:"} ${item.stock}`}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
