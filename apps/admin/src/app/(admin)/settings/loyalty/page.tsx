"use client";

import React, { useState, useEffect } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Save, Loader2, Award, Clock } from "lucide-react";

export default function LoyaltySettingsPage() {
  const { strings } = useTranslation();
  const { apiFetch } = useAuth();

  const [isEnabled, setIsEnabled] = useState(false);
  const [earnRateTaka, setEarnRateTaka] = useState(100); // 10000 minor = 100 ৳ per point
  const [pointValueTaka, setPointValueTaka] = useState(1.0); // 100 minor = 1.00 ৳
  const [minRedeemPoints, setMinRedeemPoints] = useState(100);
  const [maxBillSharePercent, setMaxBillSharePercent] = useState(50);
  const [expiryMonths, setExpiryMonths] = useState(12);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadSettings() {
      try {
        setIsLoading(true);
        const res = await apiFetch("/settings/loyalty");
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          if (mounted && data) {
            setIsEnabled(Boolean(data.isEnabled));
            if (data.earnRateMinor !== undefined) setEarnRateTaka(Number(data.earnRateMinor) / 100);
            if (data.pointValueMinor !== undefined) setPointValueTaka(Number(data.pointValueMinor) / 100);
            if (data.minRedeemPoints !== undefined) setMinRedeemPoints(data.minRedeemPoints);
            if (data.maxBillSharePercent !== undefined) setMaxBillSharePercent(data.maxBillSharePercent);
            if (data.expiryMonths !== undefined) setExpiryMonths(data.expiryMonths);
          }
        }
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load loyalty settings");
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
      const res = await apiFetch("/settings/loyalty", {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled,
          earnRateMinor: Math.round(Number(earnRateTaka) * 100),
          pointValueMinor: Math.round(Number(pointValueTaka) * 100),
          minRedeemPoints: Number(minRedeemPoints),
          maxBillSharePercent: Number(maxBillSharePercent),
          expiryMonths: Number(expiryMonths),
        }),
      });

      if (res.ok) {
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.message || "Failed to update loyalty settings");
      }
    } catch (err: any) {
      setError(err.message || "Error saving settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PermissionGate permission="tenant.read">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Award className="h-6 w-6 text-primary" />
            {strings.loyalty.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.loyalty.subtitle}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        {isSaved && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {strings.loyalty.savedSuccess}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {strings.loyalty.cardTitle}
              </CardTitle>
              <CardDescription>
                {strings.loyalty.cardSubtitle}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Program Enabled Switch */}
              <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
                <div>
                  <Label htmlFor="loyalty-enabled" className="text-base font-semibold cursor-pointer">
                    {strings.loyalty.enableProgram}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {strings.loyalty.enableHint}
                  </p>
                </div>
                <input
                  id="loyalty-enabled"
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  data-testid="loyalty-enabled-toggle"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Earn Rate */}
                <div className="space-y-2">
                  <Label htmlFor="earn-rate" className="text-sm font-semibold">
                    {strings.loyalty.earnRateLabel}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">৳</span>
                    <Input
                      id="earn-rate"
                      type="number"
                      step="1"
                      min="1"
                      value={earnRateTaka}
                      onChange={(e) => setEarnRateTaka(Number(e.target.value))}
                      className="pl-7"
                      data-testid="earn-rate-input"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {strings.loyalty.earnRateHint}
                  </p>
                </div>

                {/* Point Value */}
                <div className="space-y-2">
                  <Label htmlFor="point-value" className="text-sm font-semibold">
                    {strings.loyalty.pointValueLabel}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">৳</span>
                    <Input
                      id="point-value"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={pointValueTaka}
                      onChange={(e) => setPointValueTaka(Number(e.target.value))}
                      className="pl-7"
                      data-testid="point-value-input"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {strings.loyalty.pointValueHint}
                  </p>
                </div>

                {/* Minimum Redeem Points */}
                <div className="space-y-2">
                  <Label htmlFor="min-redeem" className="text-sm font-semibold">
                    {strings.loyalty.minRedeemLabel}
                  </Label>
                  <Input
                    id="min-redeem"
                    type="number"
                    step="1"
                    min="0"
                    value={minRedeemPoints}
                    onChange={(e) => setMinRedeemPoints(Number(e.target.value))}
                    data-testid="min-redeem-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    {strings.loyalty.minRedeemHint}
                  </p>
                </div>

                {/* Max Bill Share Percent */}
                <div className="space-y-2">
                  <Label htmlFor="max-share" className="text-sm font-semibold">
                    {strings.loyalty.maxBillShareLabel}
                  </Label>
                  <div className="relative">
                    <Input
                      id="max-share"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={maxBillSharePercent}
                      onChange={(e) => setMaxBillSharePercent(Number(e.target.value))}
                      data-testid="max-share-input"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-semibold">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {strings.loyalty.maxBillShareHint}
                  </p>
                </div>

                {/* Expiry Months */}
                <div className="space-y-2">
                  <Label htmlFor="expiry-months" className="text-sm font-semibold flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    {strings.loyalty.expiryMonthsLabel}
                  </Label>
                  <Input
                    id="expiry-months"
                    type="number"
                    step="1"
                    min="1"
                    value={expiryMonths}
                    onChange={(e) => setExpiryMonths(Number(e.target.value))}
                    data-testid="expiry-months-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    {strings.loyalty.expiryMonthsHint}
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 border-t border-border pt-4">
              <Button
                type="submit"
                disabled={isLoading || isSaving}
                className="gap-2"
                data-testid="save-loyalty-btn"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {strings.loyalty.saveChanges}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </PermissionGate>
  );
}
