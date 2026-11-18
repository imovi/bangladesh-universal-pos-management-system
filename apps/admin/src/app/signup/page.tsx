"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TenantSignupSchema, type TenantSignupDto } from "@universal-pos/shared";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Store, Moon, Sun, Globe, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { env } from "@/env";

export default function SignupPage() {
  const { locale, setLocale, strings } = useTranslation();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TenantSignupDto>({
    resolver: zodResolver(TenantSignupSchema),
    defaultValues: {
      companyName: "",
      slug: "",
      businessType: "fashion",
      owner: {
        name: "",
        email: "",
        phone: "+8801700000000",
        password: "",
      },
      branch: {
        name: "",
        code: "MAIN-01",
        address: "",
      },
    },
  });

  const handleCompanyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue("companyName", val);
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (generatedSlug.length >= 3) {
      setValue("slug", generatedSlug);
    }
  };

  const onSubmit = async (values: TenantSignupDto) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/tenants/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pos-client": "admin",
        },
        body: JSON.stringify(values),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        setErrorMessage(body.error?.message || "Failed to register shop");
        setIsSubmitting(false);
        return;
      }

      localStorage.setItem("pos_last_tenant_slug", values.slug);
      setSuccessMessage(
        locale === "bn"
          ? "দোকান সফলভাবে নিবন্ধিত হয়েছে! অনুগ্রহ করে লগইন করুন।"
          : "Shop registered successfully! Redirecting to login..."
      );

      setTimeout(() => {
        router.push("/login");
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to connect to server");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-muted/30 px-4 py-8">
      {/* Top Bar */}
      <div className="flex justify-between items-center max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Store className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">{strings.common.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            <Globe className="h-4 w-4" />
            <span>{locale === "bn" ? "English" : "বাংলা"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-8 w-8"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Signup Card */}
      <div className="flex justify-center items-center my-6">
        <Card className="w-full max-w-2xl shadow-md border-border/60">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {strings.auth.signUpTitle}
            </CardTitle>
            <CardDescription className="text-sm">
              {strings.auth.signUpSubtitle}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {errorMessage && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Business Info Section */}
              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                  {locale === "bn" ? "দোকান ও ব্যবসা সংক্রান্ত তথ্য" : "Business Details"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="companyName">{strings.auth.companyName}</Label>
                    <Input
                      id="companyName"
                      placeholder={strings.auth.companyNamePlaceholder}
                      {...register("companyName")}
                      onChange={handleCompanyNameChange}
                      aria-invalid={!!errors.companyName}
                    />
                    {errors.companyName && (
                      <p className="text-xs text-destructive">{errors.companyName.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="slug">{strings.auth.shopCode}</Label>
                    <Input
                      id="slug"
                      placeholder="e.g. my-shop"
                      {...register("slug")}
                      aria-invalid={!!errors.slug}
                    />
                    <p className="text-[11px] text-muted-foreground">{strings.auth.slugHelp}</p>
                    {errors.slug && (
                      <p className="text-xs text-destructive">{errors.slug.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="businessType">{strings.auth.businessType}</Label>
                    <select
                      id="businessType"
                      {...register("businessType")}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="fashion">{locale === "bn" ? "পোশাক ও ফ্যাশন" : "Fashion & Apparel"}</option>
                      <option value="retail">{locale === "bn" ? "সাধারণ খুচরা দোকান" : "General Retail"}</option>
                      <option value="grocery">{locale === "bn" ? "মুদি ও সুপারশপ" : "Grocery & Supermarket"}</option>
                      <option value="pharmacy">{locale === "bn" ? "ফার্মেসি" : "Pharmacy"}</option>
                      <option value="electronics">{locale === "bn" ? "ইলেকট্রনিক্স" : "Electronics"}</option>
                      <option value="other">{locale === "bn" ? "অন্যান্য" : "Other"}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Owner Account Section */}
              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                  {locale === "bn" ? "মালিকের অ্যাকাউন্ট ও লগইন তথ্য" : "Owner Account Details"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ownerName">{strings.auth.ownerName}</Label>
                    <Input
                      id="ownerName"
                      placeholder="e.g. Tariqul Islam"
                      {...register("owner.name")}
                      aria-invalid={!!errors.owner?.name}
                    />
                    {errors.owner?.name && (
                      <p className="text-xs text-destructive">{errors.owner.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ownerEmail">{strings.auth.email}</Label>
                    <Input
                      id="ownerEmail"
                      type="email"
                      placeholder="owner@example.com"
                      {...register("owner.email")}
                      aria-invalid={!!errors.owner?.email}
                    />
                    {errors.owner?.email && (
                      <p className="text-xs text-destructive">{errors.owner.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ownerPhone">{strings.auth.ownerPhone}</Label>
                    <Input
                      id="ownerPhone"
                      placeholder="+8801700000000"
                      {...register("owner.phone")}
                      aria-invalid={!!errors.owner?.phone}
                    />
                    {errors.owner?.phone && (
                      <p className="text-xs text-destructive">{errors.owner.phone.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ownerPassword">{strings.auth.password}</Label>
                    <Input
                      id="ownerPassword"
                      type="password"
                      placeholder="Password123!"
                      {...register("owner.password")}
                      aria-invalid={!!errors.owner?.password}
                    />
                    {errors.owner?.password && (
                      <p className="text-xs text-destructive">{errors.owner.password.message}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Initial Branch Section */}
              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                  {locale === "bn" ? "প্রথম শাখার বিবরণ" : "Initial Branch Details"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="branchName">{strings.auth.branchName}</Label>
                    <Input
                      id="branchName"
                      placeholder="e.g. Main Outlet, Banani"
                      {...register("branch.name")}
                      aria-invalid={!!errors.branch?.name}
                    />
                    {errors.branch?.name && (
                      <p className="text-xs text-destructive">{errors.branch.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="branchCode">{strings.auth.branchCode}</Label>
                    <Input
                      id="branchCode"
                      placeholder="e.g. MAIN-01"
                      {...register("branch.code")}
                      aria-invalid={!!errors.branch?.code}
                    />
                    {errors.branch?.code && (
                      <p className="text-xs text-destructive">{errors.branch.code.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="branchAddress">{strings.auth.branchAddress}</Label>
                    <Input
                      id="branchAddress"
                      placeholder="e.g. Road 11, Block D, Banani, Dhaka"
                      {...register("branch.address")}
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full h-10 text-base" disabled={isSubmitting}>
                {isSubmitting ? strings.common.loading : strings.auth.registerSubmit}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex justify-center border-t pt-4 text-center text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span>{strings.auth.alreadyRegistered}</span>
              <Link
                href="/login"
                className="font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
              >
                <ArrowLeft className="h-3 w-3" />
                {strings.auth.backToLogin}
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-muted-foreground">
        <p>© 2026 {strings.common.appName} — {strings.common.tagline}</p>
      </footer>
    </div>
  );
}
