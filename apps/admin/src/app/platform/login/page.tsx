"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { env } from "@/env";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/platform/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();

      if (res.ok && json.success && json.data?.accessToken) {
        // Store platform token strictly in sessionStorage (NEVER localStorage)
        sessionStorage.setItem("platform_token", json.data.accessToken);
        if (json.data.admin) {
          sessionStorage.setItem("platform_admin", JSON.stringify(json.data.admin));
        }
        router.push("/platform");
      } else {
        setError(json.error?.message || "লগইন ব্যর্থ হয়েছে। অনুগ্রহ করে তথ্য যাচাই করুন।");
      }
    } catch {
      setError("সার্ভারের সাথে সংযোগে ত্রুটি হয়েছে।");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4 select-none">
      <Card className="w-full max-w-md shadow-lg border-border" data-testid="platform-login-card">
        <CardHeader className="text-center space-y-2 pb-6">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">
            প্ল্যাটফর্ম অ্যাডমিন কনসোল
          </CardTitle>
          <CardDescription className="text-xs">
            সার্বজনীন পিওএস সিস্টেম অ্যাডমিনিস্ট্রেশন ও টেন্যান্ট ব্যবস্থাপনা
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div
                data-testid="platform-login-error"
                className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="platform-email" className="text-xs">
                অ্যাডমিন ইমেইল
              </Label>
              <Input
                id="platform-email"
                type="email"
                required
                placeholder="admin@platform.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="platform-email-input"
                className="text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="platform-password" className="text-xs">
                পাসওয়ার্ড
              </Label>
              <Input
                id="platform-password"
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="platform-password-input"
                className="text-sm"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              data-testid="platform-login-button"
              className="w-full mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  প্রবেশ করা হচ্ছে...
                </>
              ) : (
                "লগইন করুন"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
