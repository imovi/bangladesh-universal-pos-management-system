"use client";

import React, { useState } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Save } from "lucide-react";

export default function ShopSettingsPage() {
  const { strings, locale } = useTranslation();
  const { user } = useAuth();

  const [shopName, setShopName] = useState(user?.tenantName || "Artisan Apparel Ltd");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [receiptHeader, setReceiptHeader] = useState("Artisan Apparel — Fashion & Quality");
  const [receiptFooter, setReceiptFooter] = useState("Thank you for shopping with us! No refunds without receipt.");
  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <PermissionGate permission="tenant.read">
      <div className="space-y-6 max-w-4xl">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {strings.settings.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {locale === "bn"
              ? "দোকানের সাধারণ নিয়মাবলী, ভ্যাট এবং রশিদের সেটিংস"
              : "General store configurations, tax rules, and receipt text"}
          </p>
        </div>

        {isSaved && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{strings.common.saved}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Shop Information Card */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === "bn" ? "দোকানের বিবরণ" : "Store Profile"}
              </CardTitle>
              <CardDescription>
                {locale === "bn"
                  ? "দোকানের নাম ও ব্যবসায়িক আইডেন্টিটি"
                  : "Basic store identification details"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="shopName">{strings.settings.shopName}</Label>
                <Input
                  id="shopName"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">{strings.settings.timezone}</Label>
                  <select
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                    <option value="UTC">UTC</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    {strings.settings.timezoneHelp}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="currency">{strings.settings.currency}</Label>
                  <Input id="currency" value="BDT (৳)" disabled className="bg-muted cursor-not-allowed" />
                  <p className="text-[11px] text-muted-foreground">
                    {locale === "bn" ? "মুদ্রা পরিবর্তনযোগ্য নয়" : "Currency cannot be modified"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sales & Inventory Policy Card */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === "bn" ? "বিক্রি ও ভ্যাট নীতি" : "Sales & Tax Policies"}
              </CardTitle>
              <CardDescription>
                {locale === "bn"
                  ? "ভ্যাট ও স্টক সংক্রান্ত কাউন্টার নিয়ম"
                  : "Counter behaviour for tax calculation and out-of-stock items"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prices Include Tax */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-muted/20">
                <div className="space-y-0.5">
                  <Label htmlFor="pricesIncludeTax" className="text-sm font-semibold cursor-pointer">
                    {strings.settings.pricesIncludeTax}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {strings.settings.pricesIncludeTaxHelp}
                  </p>
                </div>
                <input
                  id="pricesIncludeTax"
                  type="checkbox"
                  checked={pricesIncludeTax}
                  onChange={(e) => setPricesIncludeTax(e.target.checked)}
                  className="h-5 w-5 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              {/* Allow Negative Stock */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-muted/20">
                <div className="space-y-0.5">
                  <Label htmlFor="allowNegativeStock" className="text-sm font-semibold cursor-pointer">
                    {strings.settings.allowNegativeStock}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {strings.settings.allowNegativeStockHelp}
                  </p>
                </div>
                <input
                  id="allowNegativeStock"
                  type="checkbox"
                  checked={allowNegativeStock}
                  onChange={(e) => setAllowNegativeStock(e.target.checked)}
                  className="h-5 w-5 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                />
              </div>
            </CardContent>
          </Card>

          {/* Receipt Customization Card */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === "bn" ? "রশিদ প্রিন্ট টেক্সট" : "Receipt Customization"}
              </CardTitle>
              <CardDescription>
                {locale === "bn"
                  ? "গ্রাহকের রশিদে প্রদর্শিত বার্তা"
                  : "Header and footer notes printed on customer receipts"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="receiptHeader">{strings.settings.receiptHeader}</Label>
                <Input
                  id="receiptHeader"
                  value={receiptHeader}
                  onChange={(e) => setReceiptHeader(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receiptFooter">{strings.settings.receiptFooter}</Label>
                <textarea
                  id="receiptFooter"
                  rows={2}
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end border-t pt-4">
              <Button type="submit" className="flex items-center gap-1.5">
                <Save className="h-4 w-4" />
                <span>{strings.common.save}</span>
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </PermissionGate>
  );
}
