"use client";

import React from "react";
import Link from "next/link";
import { WifiOff, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineBackOfficePage() {
  return (
    <div
      data-testid="backoffice-offline-notice"
      className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20 shadow-inner">
        <WifiOff className="w-8 h-8" />
      </div>

      <div className="max-w-md space-y-2">
        <h2 className="text-2xl font-bold text-foreground">অফলাইন মোড — ব্যাক অফিস সংযোগ নেই</h2>
        <p className="text-sm text-muted-foreground">
          ইন্টারনেট সংযোগ না থাকায় ব্যাক অফিস ড্যাশবোর্ড বা রিপোর্ট দেখা সম্ভব নয়। তবে আপনি অফলাইনে পস স্ক্রিনে বিক্রি চালিয়ে যেতে পারেন।
        </p>
      </div>

      <div className="pt-2">
        <Link href="/pos">
          <Button
            size="lg"
            data-testid="go-to-pos-offline"
            className="rounded-xl px-6 font-semibold flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <ShoppingCart className="w-5 h-5" />
            <span>পস স্ক্রিনে যান (POS)</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
