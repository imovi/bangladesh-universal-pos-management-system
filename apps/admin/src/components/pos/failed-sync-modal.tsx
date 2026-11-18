"use client";

import React, { useEffect, useState } from "react";
import { db } from "@/lib/pos/offline/db";
import type { OfflineOutboxItem } from "@/lib/pos/offline/types";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { X, AlertCircle } from "lucide-react";

interface FailedSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FailedSyncModal({ isOpen, onClose }: FailedSyncModalProps) {
  const { strings, locale } = useTranslation();
  const [failedItems, setFailedItems] = useState<OfflineOutboxItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    db.outbox
      .filter((it) => it.status === "failed")
      .toArray()
      .then(setFailedItems)
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
    >
      <div className="bg-background border border-border w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/40">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-base">
            <AlertCircle className="h-5 w-5" />
            <span>
              {strings.pos.failedOutboxItemsTitle} ({failedItems.length})
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          <p className="text-xs text-muted-foreground">
            {strings.pos.failedOutboxItemsSubtitle}
          </p>

          {failedItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {strings.pos.noFailedItems}
            </div>
          ) : (
            failedItems.map((item) => (
              <div
                key={item.id}
                className="border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 rounded-lg p-3 text-xs space-y-1.5"
              >
                <div className="flex justify-between font-mono font-bold text-foreground">
                  <span>{(item.payload as any).invoiceNumber || item.id}</span>
                  <span className="text-rose-600 dark:text-rose-400 text-[11px] uppercase">
                    {item.type}
                  </span>
                </div>
                <div className="text-rose-600 dark:text-rose-400">
                  <span className="font-semibold">{strings.pos.errorLabel}</span>
                  {item.lastError || "Rejected"}
                </div>
                <div className="text-muted-foreground text-[10px]">
                  {new Date(item.createdAt).toLocaleString(locale === "bn" ? "bn-BD" : "en-US")}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-muted/20 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {strings.common.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
