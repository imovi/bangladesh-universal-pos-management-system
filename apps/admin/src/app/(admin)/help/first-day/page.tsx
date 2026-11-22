"use client";

import React from "react";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Phone, Printer, HelpCircle } from "lucide-react";
import Link from "next/link";

export default function FirstDayChecklistPage() {
  const { locale } = useTranslation();
  const isBn = locale === "bn";

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-primary" />
          <span>{isBn ? "প্রথম দিনের কাজের তালিকা (First-Day Checklist)" : "First-Day Checklist for Shop Owner"}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isBn
            ? "দোকান উদ্বোধনের আগের রাত এবং প্রথম দিনের কাজের বিস্তারিত নির্দেশিকা।"
            : "Complete checklist for the night before launch and operations during the first business day."}
        </p>
      </div>

      {/* 1. The Night Before */}
      <Card className="shadow-sm border-border">
        <CardHeader className="bg-muted/40 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">1</span>
            <span>{isBn ? "আগের রাতে প্রস্তুতি (The Night Before)" : "The Night Before Launch"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c1" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c1" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "পণ্য, স্টক ও কাস্টমার ডাটা ইমপোর্ট (Data Import): " : "Data Import: "}</span>
              <span className="text-muted-foreground">{isBn ? "পণ্য, প্রারম্ভিক স্টক ও বাকি কাস্টমারদের তালিকা আপলোড করুন।" : "Upload products, opening stock, and existing customers via CSV."} </span>
              <Link href="/settings/import" className="text-primary underline font-medium text-xs ml-1">/settings/import</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c2" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c2" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "১০টি পণ্যের র‍্যান্ডম চেক (Random Physical Stock Check): " : "Random Physical Check: "}</span>
              <span className="text-muted-foreground">{isBn ? "তাক থেকে ১০টি কাপড় নিয়ে সফটওয়্যারের দাম ও স্টকের সাথে মিলিয়ে নিন।" : "Pick 10 random items from shelves and verify SKU, price, and stock count."}</span>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c3" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c3" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "থার্মাল প্রিন্টার ও ক্যাশ ড্রয়ার টেস্ট (Printer & Drawer): " : "Printer & Drawer Test: "}</span>
              <span className="text-muted-foreground">{isBn ? "টেস্ট রসিদ প্রিন্ট করুন এবং ক্যাশ ড্রয়ার খুলছে কি না দেখুন।" : "Print a test receipt and ensure the cash drawer opens."} </span>
              <Link href="/settings/printer" className="text-primary underline font-medium text-xs ml-1">/settings/printer</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c4" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c4" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ক্যাশিয়ার ও কর্মী তৈরি (Staff & PINs): " : "Staff & PINs Setup: "}</span>
              <span className="text-muted-foreground">{isBn ? "প্রত্যেক ক্যাশিয়ারের জন্য ইউজার ও ৪ ডিজিটের গোপন পিন সেট করুন।" : "Set up cashier accounts with 4-digit POS lock PINs."} </span>
              <Link href="/settings/users" className="text-primary underline font-medium text-xs ml-1">/settings/users</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c5" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c5" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ছাড়ের সীমা নিশ্চিতকরণ (Discount Limit): " : "Discount Limit: "}</span>
              <span className="text-muted-foreground">{isBn ? "ক্যাশিয়ার সর্বোচ্চ কত শতাংশ ছাড় দিতে পারবে তা রোল সেটিংসে ঠিক করুন।" : "Verify max line/bill discount allowed for cashiers."} </span>
              <Link href="/settings/roles" className="text-primary underline font-medium text-xs ml-1">/settings/roles</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c6" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c6" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ব্যাকআপ স্ট্যাটাস যাচাই (Backup Verification): " : "Backup Status: "}</span>
              <span className="text-muted-foreground">{isBn ? "ব্যাকআপ সচল রয়েছে কি না তা নিশ্চিত হোন।" : "Confirm last backup completed successfully."} </span>
              <Link href="/settings" className="text-primary underline font-medium text-xs ml-1">/settings</Link>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 2. Morning Opening */}
      <Card className="shadow-sm border-border">
        <CardHeader className="bg-muted/40 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">2</span>
            <span>{isBn ? "সকালে দোকান খোলা (Morning Opening)" : "Morning Opening"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c7" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c7" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ক্যাশ গুনে শিফট শুরু (Open Shift): " : "Count Cash & Open Shift: "}</span>
              <span className="text-muted-foreground">{isBn ? "ক্যাশ ড্রয়ারে থাকা প্রারম্ভিক খুচরা টাকা সঠিকভাবে গুনে শিফট ওপেন করুন।" : "Count opening float cash accurately before opening shift."} </span>
              <Link href="/pos" className="text-primary underline font-medium text-xs ml-1">/pos</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c8" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c8" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "টেস্ট সেল ও বাতিল (Test Sale & Void): " : "Test Sale & Void: "}</span>
              <span className="text-muted-foreground">{isBn ? "একটি পরীক্ষামূলক বিক্রি করুন, রসিদ প্রিন্ট দেখুন এবং সাথে সাথে রিটার্ন/বাতিল করুন।" : "Perform one test sale, verify receipt, and void/return it."}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 3. During Business Hours */}
      <Card className="shadow-sm border-border">
        <CardHeader className="bg-muted/40 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">3</span>
            <span>{isBn ? "সারাদিনের কাজের সময় (During the Day)" : "During Business Hours"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-1 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ইন্টারনেট চলে গেলে: " : "Internet Outage: "}</span>
              <span className="text-muted-foreground">
                {isBn
                  ? "আতঙ্কিত হবেন না। পিওএস নিজে থেকেই অফলাইন মোডে চলে যাবে। বিক্রি চালিয়ে যান। ইন্টারনেট ফিরলে বিক্রি স্বয়ংক্রিয়ভাবে সিঙ্ক হবে।"
                  : "Don't panic. POS seamlessly switches to offline selling. Continue selling. Sales will sync automatically once online."}
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Printer className="h-4 w-4 text-amber-500 mt-1 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "প্রিন্টার আটকে গেলে বা না চললে: " : "Printer Issue: "}</span>
              <span className="text-muted-foreground">
                {isBn
                  ? "প্রিন্টারের কাগজ ও ইউএসবি তার পরীক্ষা করুন। প্রয়োজনে ব্রাউজারের প্রিন্ট ডায়ালগ ব্যবহার করে রসিদ দিন।"
                  : "Check paper roll and USB cable. Fall back to standard browser print dialog."}
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-1 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "অ্যাপ আটকে গেলে: " : "App Unresponsive: "}</span>
              <span className="text-muted-foreground">
                {isBn
                  ? "কীবোর্ডের F5 চেপে ব্রাউজার রিফ্রেশ করুন। ডাটা নিরাপদে থাকবে।"
                  : "Press F5 to refresh browser. Offline sales and state remain safe in IndexedDB."}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Night Closing */}
      <Card className="shadow-sm border-border">
        <CardHeader className="bg-muted/40 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">4</span>
            <span>{isBn ? "রাতের ক্লোজিং ও হিসাব মিলানো (Night Closing)" : "Night Closing & Reconciliation"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c9" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c9" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "ক্যাশ টাকা গণনা (Count Cash): " : "Count Physical Cash: "}</span>
              <span className="text-muted-foreground">{isBn ? "ড্রয়ারের সমস্ত ক্যাশ টাকা নোট ও কয়েন অনুযায়ী গুনে বের করুন।" : "Count all cash, notes, and coins in drawer."}</span>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c10" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c10" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "শিফট ক্লোজ করুন (Close Shift): " : "Close Shift: "}</span>
              <span className="text-muted-foreground">{isBn ? "পিওএস-এ ক্লোজ শিফট বাটনে চাপ দিয়ে গননাকৃত নগদ টাকা ইনপুট দিয়ে শিফট সমাপ্ত করুন।" : "Click close shift on POS, enter actual cash, and view variance."} </span>
              <Link href="/shifts" className="text-primary underline font-medium text-xs ml-1">/shifts</Link>
            </label>
          </div>
          <div className="flex items-start gap-2.5">
            <input type="checkbox" id="c11" className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <label htmlFor="c11" className="text-sm">
              <span className="font-semibold text-foreground">{isBn ? "রিভিউ কিউ চেক (Review Queue): " : "Check Review Queue: "}</span>
              <span className="text-muted-foreground">{isBn ? "অফলাইন বিক্রির কোনো রসিদ রিভিউতে অপেক্ষমাণ রয়েছে কি না তা দেখুন।" : "Check if any offline sales require manager review."} </span>
              <Link href="/sales/offline-review" className="text-primary underline font-medium text-xs ml-1">/sales/offline-review</Link>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 5. Support & Emergency */}
      <Card className="border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Phone className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground">
                {isBn ? "যেকোনো সমস্যায় যোগাযোগ ও সহায়তা" : "Emergency Support Contact"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isBn
                  ? "কোনো অস্বাভাবিক সমস্যা বা সফটওয়্যার আটকে গেলে আপনার কারিগরি সহায়তা দলের সাথে যোগাযোগ করুন। যোগাযোগের সময় স্ক্রিনশট এবং ঠিক কোন সময়ে সমস্যাটি হয়েছিল তা লিখে জানান।"
                  : "If you encounter any critical error or issue, contact technical support. Please provide a full screenshot and the exact timestamp of the error."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
