"use client";

import React, { useState, useEffect } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Save, Loader2, AlertCircle } from "lucide-react";
import { BackupsCard } from "@/components/settings/backups-card";

export default function ShopSettingsPage() {
  const { strings, locale } = useTranslation();
  const { user, apiFetch } = useAuth();

  const [shopName, setShopName] = useState(user?.tenantName || "Artisan Apparel Ltd");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [currency, setCurrency] = useState("BDT");
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadSettings() {
      try {
        setIsLoading(true);
        const res = await apiFetch("/settings");
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          if (mounted && data) {
            if (data.name) setShopName(data.name);
            const s = data.settings || {};
            if (s.timezone) setTimezone(s.timezone);
            if (s.currency) setCurrency(s.currency);
            if (s.prices_include_tax !== undefined) setPricesIncludeTax(Boolean(s.prices_include_tax));
            if (s.allow_negative_stock !== undefined) setAllowNegativeStock(Boolean(s.allow_negative_stock));
            if (s.receipt_header !== undefined) setReceiptHeader(s.receipt_header);
            if (s.receipt_footer !== undefined) setReceiptFooter(s.receipt_footer);
          }
        }
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load shop settings");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: shopName.trim(),
          timezone,
          prices_include_tax: pricesIncludeTax,
          allow_negative_stock: allowNegativeStock,
          receipt_header: receiptHeader.trim(),
          receipt_footer: receiptFooter.trim(),
        }),
      });
      if (res.ok) {
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        const errJson = await res.json();
        setError(errJson.error?.message || errJson.message || "Failed to save settings");
      }
    } catch (err: any) {
      setError(err.message || "Network error while saving settings");
    } finally {
      setIsSaving(false);
    }
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

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isSaved && (
          <div
            role="alert"
            data-testid="shop-settings-saved-banner"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{strings.common.saved}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Shop Information Card */}
            <Card className="shadow-xs border border-border">
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
                    data-testid="shop-name-input"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {locale === "bn"
                      ? "ইনভয়েস এবং রিপোর্টে প্রদর্শিত দোকানের প্রাতিষ্ঠানিক নাম"
                      : "Official business name printed on invoices, reports, and headers"}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="timezone">{strings.settings.timezone}</Label>
                    <select
                      id="timezone"
                      data-testid="shop-timezone-select"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                      <option value="UTC">UTC (GMT+0)</option>
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      {strings.settings.timezoneHelp}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="currency">{strings.settings.currency}</Label>
                    <Input id="currency" value={`${currency} (৳)`} disabled className="bg-muted cursor-not-allowed" />
                    <p className="text-[11px] text-muted-foreground">
                      {locale === "bn" ? "মুদ্রা পরিবর্তনযোগ্য নয়" : "Currency cannot be modified"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sales & Inventory Policy Card */}
            <Card className="shadow-xs border border-border">
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
            <Card className="shadow-xs border border-border">
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
                    data-testid="shop-receipt-header"
                    value={receiptHeader}
                    onChange={(e) => setReceiptHeader(e.target.value)}
                    placeholder={locale === "bn" ? "যেমন: ফ্যাশন ও কোয়ালিটির বিশ্বস্ত প্রতিষ্ঠান" : "e.g. Quality and Style Guaranteed"}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {locale === "bn" ? "মুদ্রিত রশিদের শীর্ষে যে বার্তা বা স্লোগান থাকবে" : "Header text printed at the top of every receipt"}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="receiptFooter">{strings.settings.receiptFooter}</Label>
                  <textarea
                    id="receiptFooter"
                    data-testid="shop-receipt-footer"
                    rows={2}
                    value={receiptFooter}
                    onChange={(e) => setReceiptFooter(e.target.value)}
                    placeholder={locale === "bn" ? "যেমন: ক্রয়ের জন্য ধন্যবাদ! পণ্য পরিবর্তনের জন্য রশিদ সংরক্ষণ করুন।" : "e.g. Thank you for shopping with us! No returns without receipt."}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {locale === "bn" ? "মুদ্রিত রশিদের নিচে কৃতজ্ঞতা বা নিয়ম সংক্রান্ত বার্তা" : "Footer text printed at the bottom of every receipt"}
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end border-t border-border pt-4">
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSaving}
                  data-testid="save-shop-settings-btn"
                  className="flex items-center gap-1.5 font-semibold"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span>{strings.common.save}</span>
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </form>
        )}

        <BackupsCard />
      </div>
    </PermissionGate>
  );
}
