"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Store, Moon, Sun, Globe, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";

const LoginSchema = z.object({
  tenantSlug: z.string().min(1, "Shop code is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
  rememberSlug: z.boolean().default(true),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

function LoginForm() {
  const { login, isAuthenticated, user } = useAuth();
  const { locale, setLocale, strings } = useTranslation();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/dashboard";

  const getTargetUrl = (targetUser: any, fallback: string) => {
    if (fallback && fallback !== "/dashboard") return fallback;
    if (!targetUser) return fallback;
    const hasAdminPerms =
      targetUser.isOwner ||
      targetUser.permissions?.includes("*") ||
      targetUser.permissions?.some((p: string) =>
        ["report.sales", "report.profit", "tenant.read", "purchase.read", "role.read", "user.read"].includes(p)
      );
    if (!hasAdminPerms && targetUser.permissions?.includes("sale.create")) {
      return "/pos";
    }
    return fallback;
  };

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      tenantSlug: "",
      email: "",
      password: "",
      rememberSlug: true,
    },
  });

  useEffect(() => {
    const savedSlug = localStorage.getItem("pos_last_tenant_slug");
    if (savedSlug) {
      setValue("tenantSlug", savedSlug);
    }
  }, [setValue]);

  useEffect(() => {
    if (isAuthenticated) {
      router.push(getTargetUrl(user, from));
    }
  }, [isAuthenticated, user, router, from]);

  const onSubmit = async (values: LoginFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    if (values.rememberSlug) {
      localStorage.setItem("pos_last_tenant_slug", values.tenantSlug);
    } else {
      localStorage.removeItem("pos_last_tenant_slug");
    }

    const result = await login({
      tenantSlug: values.tenantSlug,
      email: values.email,
      password: values.password,
    });

    setIsSubmitting(false);

    if (!result.success) {
      if (result.status === 429) {
        setErrorMessage(strings.auth.rateLimited);
      } else {
        setErrorMessage(strings.auth.invalidCredentials);
      }
    } else {
      router.push(getTargetUrl(user, from));
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-muted/30 px-4 py-8">
      {/* Top Bar with Language and Theme Controls */}
      <div className="flex justify-between items-center max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Store className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">{strings.common.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="language-toggle"
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
            className="flex items-center gap-1.5 text-xs font-semibold"
            aria-label={strings.language.toggle}
          >
            <Globe className="h-4 w-4" />
            <span>{locale === "bn" ? "English" : "বাংলা"}</span>
          </Button>
          <Button
            data-testid="theme-toggle"
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-8 w-8"
            aria-label={strings.theme.toggle}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Login Card */}
      <div className="flex justify-center items-center my-auto">
        <Card className="w-full max-w-md shadow-md border-border/60">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {strings.auth.signInTitle}
            </CardTitle>
            <CardDescription className="text-sm">
              {strings.auth.signInSubtitle}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {errorMessage && (
              <div
                data-testid="error-alert"
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tenantSlug">{strings.auth.shopCode}</Label>
                <Input
                  id="tenantSlug"
                  placeholder={strings.auth.shopCodePlaceholder}
                  autoComplete="organization"
                  {...register("tenantSlug")}
                  aria-invalid={!!errors.tenantSlug}
                />
                {errors.tenantSlug && (
                  <p className="text-xs text-destructive">{errors.tenantSlug.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">{strings.auth.email}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={strings.auth.emailPlaceholder}
                  autoComplete="email"
                  {...register("email")}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">{strings.auth.password}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={strings.auth.passwordPlaceholder}
                  autoComplete="current-password"
                  {...register("password")}
                  aria-invalid={!!errors.password}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  id="rememberSlug"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  {...register("rememberSlug")}
                />
                <label htmlFor="rememberSlug" className="text-xs text-muted-foreground select-none cursor-pointer">
                  {strings.auth.rememberShopCode}
                </label>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? strings.common.loading : strings.auth.signIn}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex flex-col gap-2 border-t pt-4 text-center text-xs text-muted-foreground">
            <div className="flex items-center justify-center gap-1">
              <span>{strings.auth.needAccount}</span>
              <Link
                href="/signup"
                className="font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {strings.auth.registerNow}
                <ArrowRight className="h-3 w-3" />
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

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
