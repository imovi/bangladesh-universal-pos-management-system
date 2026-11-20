"use client";

import React from "react";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/utils";

export interface ReturnLineItem {
  saleItemId: string;
  variantId: string;
  productName: string;
  variantName?: string;
  sku: string;
  soldQty: number;
  returnedQty: number;
  returnableQty: number;
  unitPriceMinor: number;
  taxMinor: number;
  totalMinor: number;
  selectedQty: number;
  condition: "resellable" | "damaged";
}

export interface ReturnLinesTableProps {
  lines: ReturnLineItem[];
  onUpdateQty: (index: number, qty: number) => void;
  onUpdateCondition: (index: number, cond: "resellable" | "damaged") => void;
}

export function ReturnLinesTable({
  lines,
  onUpdateQty,
  onUpdateCondition,
}: ReturnLinesTableProps) {
  const { locale } = useTranslation();

  return (
    <div
      data-testid="return-lines-table"
      className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden"
    >
      <table className="w-full text-xs">
        <thead className="bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-semibold border-b border-neutral-200 dark:border-neutral-800">
          <tr>
            <th className="py-2.5 px-3 text-left">{locale === "bn" ? "পণ্য" : "Item"}</th>
            <th className="py-2.5 px-2 text-center">{locale === "bn" ? "বিক্রি" : "Sold"}</th>
            <th className="py-2.5 px-2 text-center">{locale === "bn" ? "ফেরতযোগ্য" : "Available"}</th>
            <th className="py-2.5 px-3 text-center">{locale === "bn" ? "ফেরত পরিমাণ" : "Return Qty"}</th>
            <th className="py-2.5 px-3 text-center">{locale === "bn" ? "অবস্থা" : "Condition"}</th>
            <th className="py-2.5 px-3 text-right">{locale === "bn" ? "আনুমানিক রিফান্ড" : "Est. Refund"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {lines.map((line, idx) => {
            const isAvailable = line.returnableQty > 0;
            const lineEstRefund = Math.round(
              (line.soldQty > 0 ? line.totalMinor / line.soldQty : 0) * line.selectedQty,
            );

            return (
              <tr
                key={line.saleItemId}
                className={!isAvailable ? "opacity-50 bg-neutral-50 dark:bg-neutral-900/40" : ""}
                data-testid={`return-line-row-${idx}`}
              >
                <td className="py-2.5 px-3">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {line.productName}
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono">
                    {line.sku} {line.variantName ? `• ${line.variantName}` : ""}
                  </div>
                </td>
                <td className="py-2.5 px-2 text-center">{line.soldQty}</td>
                <td className="py-2.5 px-2 text-center font-bold text-amber-700 dark:text-amber-400">
                  {line.returnableQty}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 w-6 p-0 text-xs"
                      disabled={!isAvailable || line.selectedQty <= 0}
                      onClick={() => onUpdateQty(idx, line.selectedQty - 1)}
                      data-testid={`return-qty-minus-${idx}`}
                    >
                      -
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      max={line.returnableQty}
                      value={line.selectedQty}
                      onChange={(e) =>
                        onUpdateQty(idx, parseInt(e.target.value, 10) || 0)
                      }
                      disabled={!isAvailable}
                      className="h-6 w-12 text-center px-1 text-xs font-bold"
                      data-testid={`return-qty-input-${idx}`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 w-6 p-0 text-xs"
                      disabled={!isAvailable || line.selectedQty >= line.returnableQty}
                      onClick={() => onUpdateQty(idx, line.selectedQty + 1)}
                      data-testid={`return-qty-plus-${idx}`}
                    >
                      +
                    </Button>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center">
                  {line.selectedQty > 0 ? (
                    <Select
                      value={line.condition}
                      onValueChange={(val: "resellable" | "damaged") =>
                        onUpdateCondition(idx, val)
                      }
                    >
                      <SelectTrigger className="h-6 text-[11px] w-28 mx-auto" data-testid={`return-condition-select-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="resellable">
                          {locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable"}
                        </SelectItem>
                        <SelectItem value="damaged">
                          {locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-neutral-400">-</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-medium text-red-600 dark:text-red-400">
                  {line.selectedQty > 0 ? `-${formatMoney(lineEstRefund)}` : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
