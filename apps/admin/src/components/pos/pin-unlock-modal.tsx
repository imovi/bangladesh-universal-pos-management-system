"use client";

import React, { useState } from "react";
import { Lock, AlertCircle, ShieldCheck } from "lucide-react";
import { verifyOfflinePin, saveOfflinePinVerifier } from "@/lib/pos/offline/pin-verifier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PinUnlockModalProps {
  isOpen: boolean;
  userName?: string;
  userId?: string;
  onUnlock: () => void;
}

export function PinUnlockModal({
  isOpen,
  userName = "Cashier",
  userId,
  onUnlock,
}: PinUnlockModalProps) {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setErrorMsg("পিন নম্বর ন্যূনতম ৪ ডিজিট হতে হবে");
      return;
    }

    setIsVerifying(true);
    setErrorMsg(null);

    try {
      const uId = userId || "default-cashier";
      let result = await verifyOfflinePin(uId, pin);

      // If no verifier was initialized yet, accept default demo PIN "1234" and initialize verifier
      if (!result.success && result.error === "NOT_FOUND") {
        if (pin === "1234") {
          await saveOfflinePinVerifier(uId, "1234");
          result = { success: true };
        } else {
          result = { success: false, error: "INVALID_PIN", remainingAttempts: 4 };
        }
      }

      if (result.success) {
        setPin("");
        setErrorMsg(null);
        setIsLocked(false);
        onUnlock();
      } else {
        if (result.error === "LOCKED") {
          setIsLocked(true);
          setErrorMsg("অতিরিক্ত ভুল চেষ্টার কারণে ১৫ মিনিটের জন্য লক করা হয়েছে");
        } else if (result.error === "EXPIRED") {
          setErrorMsg("অফলাইন সেশনের মেয়াদ শেষ হয়েছে — সংযোগ এলে পুনরায় লগইন করুন");
        } else if (result.error === "INVALID_PIN") {
          setErrorMsg(`ভুল পিন নম্বর — আবার চেষ্টা করুন (বাকি চেষ্টা: ${result.remainingAttempts} বার)`);
        } else {
          setErrorMsg("পিন যাচাইকরণ ব্যর্থ হয়েছে");
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "যাচাইকরণে ত্রুটি হয়েছে");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      data-testid="pin-unlock-modal"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
          <Lock className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">পস স্ক্রিন আনলক করুন</h2>
          <p className="text-sm text-muted-foreground">
            ক্যাশিয়ার: <span className="font-semibold text-foreground">{userName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            অফলাইনে বিক্রি চালিয়ে যেতে আপনার গোপন পিন দিন
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              disabled={isLocked || isVerifying}
              data-testid="pin-input"
              value={pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setPin(val);
                setErrorMsg(null);
              }}
              placeholder="••••"
              className="text-center text-2xl tracking-[0.5em] font-mono h-12 rounded-xl"
            />

            {errorMsg && (
              <div
                data-testid={isLocked ? "pin-locked" : "pin-error"}
                className="flex items-center justify-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 py-1.5 px-2.5 rounded-lg border border-destructive/20 animate-shake"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          <Button
            type="submit"
            disabled={isLocked || isVerifying || pin.length < 4}
            data-testid="pin-unlock-button"
            className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-md shadow-primary/20"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{isVerifying ? "যাচাই করা হচ্ছে…" : "আনলক করুন"}</span>
          </Button>
        </form>

        <div className="text-[11px] text-muted-foreground border-t border-border pt-3">
          পাসওয়ার্ড বা পিন ভুলে গেলে অ্যাডমিন বা ম্যানেজারের সাথে যোগাযোগ করুন
        </div>
      </div>
    </div>
  );
}
