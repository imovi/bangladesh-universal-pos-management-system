"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ServiceWorkerPromptProps {
  hasCartItems: boolean;
  hasUnsyncedOutbox: boolean;
}

export function ServiceWorkerPrompt({
  hasCartItems,
  hasUnsyncedOutbox,
}: ServiceWorkerPromptProps) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Only register service worker in production builds
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // Check if a worker is already waiting
          if (registration.waiting) {
            setWaitingWorker(registration.waiting);
            setShowPrompt(true);
          }

          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  setWaitingWorker(newWorker);
                  setShowPrompt(true);
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn("[SW] Registration failed:", err);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }, []);

  const handleApplyUpdate = () => {
    if (hasCartItems || hasUnsyncedOutbox) {
      setWarningMessage("কার্ট খালি করুন এবং সব বিক্রি সার্ভারে পাঠানো পর্যন্ত অপেক্ষা করুন");
      return;
    }

    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  };

  if (!showPrompt) return null;

  return (
    <div
      data-testid="sw-update-prompt"
      className="fixed bottom-4 right-4 z-50 max-w-sm bg-primary text-primary-foreground p-3.5 rounded-xl shadow-xl border border-primary-foreground/20 flex flex-col gap-2 animate-in slide-in-from-bottom duration-300"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
          <span className="text-xs font-semibold">নতুন ভার্সন এসেছে — রিফ্রেশ করুন</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleApplyUpdate}
          data-testid="sw-refresh-button"
          className="h-7 px-2.5 text-xs font-bold shrink-0"
        >
          রিফ্রেশ
        </Button>
      </div>

      {warningMessage && (
        <p className="text-[11px] text-amber-200 bg-black/20 p-1.5 rounded-md">
          {warningMessage}
        </p>
      )}
    </div>
  );
}
