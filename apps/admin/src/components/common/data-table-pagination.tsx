"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/i18n/context";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  pageSizeOptions?: number[];
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: DataTablePaginationProps) {
  const { strings } = useTranslation();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-card text-xs text-muted-foreground select-none">
      <div className="flex items-center gap-2">
        <span className="font-mono tabular-nums font-medium text-foreground">
          {total === 0 ? "0 / 0" : `${startItem}–${endItem} / ${total}`}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-4">
            <span className="hidden sm:inline">{strings.common.showing}:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                onPageSizeChange(Number(val));
                onPageChange(1);
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs px-2">
                <SelectValue placeholder={String(pageSize)} />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)} className="text-xs">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="h-8 px-2.5 text-xs flex items-center gap-1"
          aria-label={strings.common.previous}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>{strings.common.previous}</span>
        </Button>
        <span className="px-2 font-mono tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="h-8 px-2.5 text-xs flex items-center gap-1"
          aria-label={strings.common.next}
        >
          <span>{strings.common.next}</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
