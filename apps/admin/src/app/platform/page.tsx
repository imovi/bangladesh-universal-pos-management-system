"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { env } from "@/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck,
  LogOut,
  Building2,
  Search,
  Loader2,
  AlertCircle,
  Lock,
  Unlock,
} from "lucide-react";
import { MODULE_KEYS, MODULE_INFO, type ModuleKey } from "@universal-pos/shared";

interface TenantModuleState {
  key: string;
  allowed: boolean;
  enabled: boolean;
}

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  status: string;
  modules: TenantModuleState[];
}

export default function PlatformDashboardPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<{ id: string; email: string; name: string } | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("platform_token");
    if (!token) {
      router.push("/platform/login");
      return;
    }

    const savedAdmin = sessionStorage.getItem("platform_admin");
    if (savedAdmin) {
      try {
        setAdminUser(JSON.parse(savedAdmin));
      } catch {}
    }

    fetchTenants(token);
  }, []);

  const fetchTenants = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/platform/tenants`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 401) {
        sessionStorage.removeItem("platform_token");
        sessionStorage.removeItem("platform_admin");
        router.push("/platform/login");
        return;
      }

      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setTenants(json.data);
      } else {
        setError(json.error?.message || "টেন্যান্ট তালিকা লোড করা সম্ভব হয়নি।");
      }
    } catch {
      setError("সার্ভারের সাথে সংযোগ বিচ্ছিন্ন হয়েছে।");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("platform_token");
    sessionStorage.removeItem("platform_admin");
    router.push("/platform/login");
  };

  const handleToggleModuleAllowed = async (tenantId: string, tenantSlug: string, key: ModuleKey, currentAllowed: boolean) => {
    const token = sessionStorage.getItem("platform_token");
    if (!token) {
      router.push("/platform/login");
      return;
    }

    const updateId = `${tenantId}:${key}`;
    setUpdatingKey(updateId);

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/platform/tenants/${tenantId}/modules/${key}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ allowed: !currentAllowed }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setTenants((prev) =>
          prev.map((t) => {
            if (t.id !== tenantId) return t;
            const existingModIdx = t.modules.findIndex((m) => m.key === key);
            let updatedModules = [...t.modules];
            if (existingModIdx >= 0) {
              updatedModules[existingModIdx] = {
                ...updatedModules[existingModIdx],
                allowed: json.data.allowed,
                enabled: json.data.enabled,
              };
            } else {
              updatedModules.push({
                key,
                allowed: json.data.allowed,
                enabled: json.data.enabled,
              });
            }
            return { ...t, modules: updatedModules };
          })
        );
      } else {
        alert(json.error?.message || "মডিউল অনুমতি পরিবর্তন ব্যর্থ হয়েছে।");
      }
    } catch {
      alert("সার্ভার সংযোগে ত্রুটি হয়েছে।");
    } finally {
      setUpdatingKey(null);
    }
  };

  const filteredTenants = useMemo(() => {
    if (!search.trim()) return tenants;
    const term = search.toLowerCase();
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        t.slug.toLowerCase().includes(term) ||
        t.businessType.toLowerCase().includes(term)
    );
  }, [tenants, search]);

  return (
    <div className="min-h-screen bg-muted/20 select-none" data-testid="platform-tenants-page">
      {/* Top Navbar */}
      <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight leading-none">
              Universal POS — Platform Administration
            </h1>
            <span className="text-[11px] text-muted-foreground font-mono">
              Tenant & Module Allowlist Manager
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {adminUser && (
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-foreground">{adminUser.name}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{adminUser.email}</p>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            data-testid="platform-logout-button"
            className="text-xs gap-1.5"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>লগআউট</span>
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              নিবন্ধিত টেন্যান্ট তালিকা ({tenants.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              প্রতিটি টেন্যান্টের জন্য অনুমোদিত মডিউল (Allowlist) সরাসরি প্ল্যাটফর্ম থেকে নিয়ন্ত্রণ করুন।
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="টেন্যান্ট অনুসন্ধান..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>টেন্যান্ট লোড হচ্ছে...</span>
          </div>
        ) : filteredTenants.length === 0 ? (
          <Card className="py-12 text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm">কোন টেন্যান্ট পাওয়া যায়নি।</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredTenants.map((t) => (
              <Card
                key={t.id}
                data-testid={`platform-tenant-card-${t.slug}`}
                className="overflow-hidden border-border shadow-sm"
              >
                <CardHeader className="bg-muted/30 py-3.5 px-6 border-b border-border/60">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <CardTitle className="text-base font-semibold text-foreground">
                        {t.name}
                      </CardTitle>
                      <Badge variant="outline" className="font-mono text-[11px] bg-background">
                        {t.slug}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="text-[11px] capitalize bg-primary/10 text-primary border-primary/20"
                      >
                        {t.businessType}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>স্ট্যাটাস:</span>
                      <span className="font-semibold text-foreground capitalize">{t.status}</span>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      মডিউল অনুমোদন সেটিংস (Module Allowlist)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                      {MODULE_KEYS.map((key) => {
                        const info = MODULE_INFO[key];
                        const modState = t.modules.find((m) => m.key === key);
                        const isAllowed = modState?.allowed ?? false;
                        const isUpdating = updatingKey === `${t.id}:${key}`;

                        return (
                          <div
                            key={key}
                            data-testid={`platform-module-item-${t.slug}-${key}`}
                            className={`p-3 rounded-lg border text-xs flex flex-col justify-between gap-2 transition-all ${
                              isAllowed
                                ? "bg-card border-primary/30"
                                : "bg-muted/10 border-border/70 opacity-80"
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-semibold text-foreground truncate">
                                  {info.nameBn}
                                </span>
                                {isAllowed ? (
                                  <Unlock className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                ) : (
                                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">
                                {key}
                              </p>
                            </div>

                            <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <span className="text-muted-foreground">অনুমতি:</span>
                                <span
                                  className={`font-semibold ${
                                    isAllowed
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {isAllowed ? "অনুমোদিত" : "নিষিদ্ধ"}
                                </span>
                              </div>

                              <button
                                type="button"
                                role="switch"
                                aria-checked={isAllowed}
                                disabled={isUpdating}
                                onClick={() => handleToggleModuleAllowed(t.id, t.slug, key, isAllowed)}
                                data-testid={`platform-module-switch-${t.slug}-${key}`}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                                  isAllowed ? "bg-primary" : "bg-muted"
                                } ${isUpdating ? "opacity-40 cursor-wait" : ""}`}
                              >
                                <span className="sr-only">{info.nameBn}</span>
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    isAllowed ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
