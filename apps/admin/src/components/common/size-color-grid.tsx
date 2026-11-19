"use client";

import React, { useState, useMemo } from "react";
import { cn, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy } from "lucide-react";
import { sortSizes } from "@universal-pos/shared";

export interface GridCellData {
  value: number; // Quantity or PriceMinor
  sku?: string;
  lowStock?: boolean;
  outOfStock?: boolean;
  disabled?: boolean;
}

export interface SizeColorGridProps {
  sizes: string[];
  colors: string[];
  matrix: Record<string, GridCellData>; // key: `${color}:${size}`
  onChange?: (color: string, size: string, value: number) => void;
  onToggleCell?: (color: string, size: string, enabled: boolean) => void;
  readOnly?: boolean;
  mode?: "stock" | "price";
  className?: string;
}

export function SizeColorGrid({
  sizes,
  colors,
  matrix,
  onChange,
  onToggleCell,
  readOnly = false,
  mode = "stock",
  className,
}: SizeColorGridProps) {
  const [applyValue, setApplyValue] = useState<string>("");
  const displaySizes = useMemo(() => sortSizes(sizes), [sizes]);

  const getCellKey = (color: string, size: string) => `${color}:${size}`;

  const handleApplyAll = () => {
    const num = Number(applyValue);
    if (isNaN(num) || !onChange) return;
    for (const c of colors) {
      for (const s of displaySizes) {
        const key = getCellKey(c, s);
        if (!matrix[key]?.disabled) {
          onChange(c, s, mode === "price" ? Math.round(num * 100) : num);
        }
      }
    }
    setApplyValue("");
  };

  const handleApplyRow = (color: string) => {
    const firstVal = matrix[getCellKey(color, displaySizes[0])]?.value ?? 0;
    if (!onChange) return;
    for (const s of displaySizes) {
      const key = getCellKey(color, s);
      if (!matrix[key]?.disabled) {
        onChange(color, s, firstVal);
      }
    }
  };

  const handleApplyCol = (size: string) => {
    const firstVal = matrix[getCellKey(colors[0], size)]?.value ?? 0;
    if (!onChange) return;
    for (const c of colors) {
      const key = getCellKey(c, size);
      if (!matrix[key]?.disabled) {
        onChange(c, size, firstVal);
      }
    }
  };

  if (sizes.length === 0 || colors.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
        সাইজ এবং রঙের অপশন যোগ করলে এখানে গ্রিড প্রদর্শিত হবে (Add size and colour options to generate the matrix).
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="size-color-grid">
      {/* Batch Application Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-muted/40 border text-xs">
          <span className="font-medium text-muted-foreground">
            {mode === "price" ? "সবগুলোতে মূল্য বসান (Taka):" : "সবগুলোতে পরিমাণ বসান:"}
          </span>
          <Input
            data-testid="grid-bulk-input"
            type="number"
            value={applyValue}
            onChange={(e) => setApplyValue(e.target.value)}
            placeholder={mode === "price" ? "1200" : "10"}
            className="w-24 h-7 text-xs bg-background"
            min={0}
          />
          <Button
            data-testid="grid-bulk-apply-btn"
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleApplyAll}
            className="h-7 text-xs px-2.5"
            disabled={!applyValue}
          >
            প্রয়োগ করুন (Apply to All)
          </Button>
        </div>
      )}

      {/* Responsive Matrix Container */}
      <div className="overflow-x-auto rounded-lg border border-border shadow-sm bg-card">
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground">
              <th className="p-3 w-36 border-r sticky left-0 bg-muted/50 z-10">
                রং \ সাইজ (Colour \ Size)
              </th>
              {displaySizes.map((s) => (
                <th key={s} className="p-3 text-center min-w-[90px]">
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-bold text-foreground text-sm">{s}</span>
                    {!readOnly && colors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleApplyCol(s)}
                        title="Copy first cell value down this column"
                        className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
                      >
                        <Copy className="h-2.5 w-2.5" />
                        কলামে কপি
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                <td className="p-3 font-semibold text-foreground border-r sticky left-0 bg-card z-10 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate">{c}</span>
                    {!readOnly && displaySizes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleApplyRow(c)}
                        title="Copy first cell value across this row"
                        className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5 shrink-0"
                      >
                        <Copy className="h-2.5 w-2.5" />
                        সারিতে কপি
                      </button>
                    )}
                  </div>
                </td>
                {displaySizes.map((s) => {
                  const key = getCellKey(c, s);
                  const cell = matrix[key] || { value: 0 };
                  const isOutOfStock = cell.value === 0;
                  const isLow = cell.lowStock || (mode === "stock" && cell.value > 0 && cell.value <= 5);

                  return (
                    <td
                      key={s}
                      className={cn(
                        "p-2 text-center border-l first:border-l-0 transition-colors",
                        cell.disabled ? "bg-muted/40 opacity-50" : ""
                      )}
                    >
                      {readOnly ? (
                        <div className="flex flex-col items-center justify-center p-1">
                          <span
                            className={cn(
                              "font-bold text-sm",
                              mode === "price"
                                ? "text-foreground"
                                : isOutOfStock
                                ? "text-destructive"
                                : isLow
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {mode === "price" ? formatMoney(cell.value) : cell.value}
                          </span>
                          {mode === "stock" && isOutOfStock && (
                            <span className="text-[10px] text-destructive font-medium">শূন্য (Out)</span>
                          )}
                          {mode === "stock" && isLow && !isOutOfStock && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">কম (Low)</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          {onToggleCell && (
                            <input
                              type="checkbox"
                              checked={!cell.disabled}
                              onChange={(e) => onToggleCell(c, s, e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-primary"
                              title="Stock this combination"
                            />
                          )}
                          <Input
                            type="number"
                            min={0}
                            disabled={cell.disabled}
                            value={mode === "price" ? cell.value / 100 : cell.value}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (onChange) {
                                onChange(c, s, mode === "price" ? Math.round(val * 100) : val);
                              }
                            }}
                            className={cn(
                              "h-8 text-center text-xs font-semibold px-1 w-20 bg-background",
                              cell.disabled ? "cursor-not-allowed opacity-40" : ""
                            )}
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
