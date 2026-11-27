"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Lock, Loader2, Blocks } from "lucide-react";
import type { ModuleKey } from "@universal-pos/shared";

interface TenantModuleItem {
  key: ModuleKey;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  dependsOn: ModuleKey[];
  allowed: boolean;
  enabled: boolean;
  active: boolean;
}

export default function TenantModulesPage() {
  const { user, apiFetch } = useAuth();
  const [modules, setModules] = useState<TenantModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const isOwner = Boolean(user?.isOwner || user?.roles?.includes("Owner"));

  const fetchModules = async () => {
    try {
      setLoading(true);
      setGlobalError(null);
      const res = await apiFetch("/modules");
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setModules(json.data);
      } else {
        setGlobalError(json.error?.message || "মডিউল তালিকা লোড করা সম্ভব হয়নি");
      }
    } catch {
      setGlobalError("সার্ভারের সাথে সংযোগে ত্রুটি হয়েছে");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  const handleToggle = async (mod: TenantModuleItem) => {
    if (!isOwner || !mod.allowed || updatingKey) return;

    const newEnabled = !mod.enabled;
    setUpdatingKey(mod.key);
    setErrorMap((prev) => ({ ...prev, [mod.key]: "" }));

    try {
      const res = await apiFetch(`/modules/${mod.key}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: newEnabled }),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        setModules((prev) =>
          prev.map((m) => (m.key === mod.key ? { ...m, ...json.data } : m))
        );
      } else {
        const err = json.error;
        let msg = err?.message || "মডিউল স্ট্যাটাস পরিবর্তন করা যায়নি";

        if (err?.code === "MODULE_DEPENDENCY_MISSING") {
          const missing = (err.missingModules || [])
            .map((k: ModuleKey) => {
              const dep = modules.find((m) => m.key === k);
              return dep ? dep.nameBn : k;
            })
            .join(", ");
          msg = `এটি চালু করার পূর্বে প্রয়োজনীয় মডিউল চালু করতে হবে: ${missing}`;
        } else if (err?.code === "MODULE_IN_USE_BY_DEPENDENT") {
          const dependents = (err.dependentModules || [])
            .map((k: ModuleKey) => {
              const dep = modules.find((m) => m.key === k);
              return dep ? dep.nameBn : k;
            })
            .join(", ");
          msg = `এটি বন্ধ করা যাবে না কারণ সক্রিয় মডিউল এটির ওপর নির্ভরশীল: ${dependents}`;
        }

        setErrorMap((prev) => ({ ...prev, [mod.key]: msg }));
      }
    } catch {
      setErrorMap((prev) => ({
        ...prev,
        [mod.key]: "সার্ভারের সাথে সংযোগ বিচ্ছিন্ন হয়েছে",
      }));
    } finally {
      setUpdatingKey(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl" data-testid="modules-settings-page">
      <div>
        <div className="flex items-center gap-2">
          <Blocks className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            মডিউল সেটিংস
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          আপনার দোকানের বিশেষ ফিচারের জন্য মডিউল সক্রিয় বা নিষ্ক্রিয় করুন।
        </p>
      </div>

      {globalError && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>লোড হচ্ছে...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map((mod) => {
            const isUpdating = updatingKey === mod.key;
            const itemError = errorMap[mod.key];
            const missingDepKeys = (mod.dependsOn || []).filter((depKey) => {
              const dep = modules.find((m) => m.key === depKey);
              return !dep?.active;
            });
            const missingDepNames = missingDepKeys
              .map((k) => modules.find((m) => m.key === k)?.nameBn || k)
              .join(", ");

            return (
              <Card
                key={mod.key}
                data-testid={`module-card-${mod.key}`}
                className={`relative transition-all ${
                  mod.active
                    ? "border-primary/40 bg-card shadow-sm"
                    : !mod.allowed
                    ? "opacity-75 bg-muted/20 border-border"
                    : "bg-card border-border"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base font-semibold text-foreground">
                          {mod.nameBn}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground font-mono">
                          ({mod.nameEn})
                        </span>
                      </div>
                      <CardDescription className="text-xs leading-relaxed">
                        {mod.descriptionBn}
                      </CardDescription>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {mod.active ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs flex items-center gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>সক্রিয়</span>
                        </Badge>
                      ) : !mod.allowed ? (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs flex items-center gap-1"
                        >
                          <Lock className="h-3 w-3" />
                          <span>অনুমতি নেই</span>
                        </Badge>
                      ) : mod.enabled && !mod.active ? (
                        <Badge
                          variant="outline"
                          data-testid={`module-dep-inactive-badge-${mod.key}`}
                          className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs flex items-center gap-1"
                        >
                          <AlertCircle className="h-3 w-3" />
                          <span>নির্ভরশীল মডিউল বন্ধ ({missingDepNames})</span>
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-muted text-muted-foreground border-border text-xs"
                        >
                          বন্ধ
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0 space-y-3">
                  {/* Dependencies indicator if any */}
                  {mod.dependsOn && mod.dependsOn.length > 0 && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground/80">নির্ভরশীল:</span>
                      {mod.dependsOn.map((depKey) => {
                        const dep = modules.find((m) => m.key === depKey);
                        const depName = dep ? dep.nameBn : depKey;
                        const depIsActive = dep?.active;
                        return (
                          <span
                            key={depKey}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                              depIsActive
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {depName}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Error display */}
                  {itemError && (
                    <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="leading-tight">{itemError}</span>
                    </div>
                  )}

                  {/* Controls / Information */}
                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <div>
                      {!mod.allowed ? (
                        <span
                          data-testid={`module-not-allowed-msg-${mod.key}`}
                          className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"
                        >
                          <Lock className="h-3 w-3 inline" />
                          <span>প্ল্যাটফর্ম থেকে চালু করা হয়নি</span>
                        </span>
                      ) : !isOwner ? (
                        <span className="text-xs text-muted-foreground">
                          শুধুমাত্র মালিক পরিবর্তন করতে পারবেন
                        </span>
                      ) : mod.enabled && !mod.active ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 inline" />
                          <span>নির্ভরশীল মডিউল বন্ধ ({missingDepNames})</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {mod.enabled ? "মডিউলটি চালু আছে" : "মডিউলটি বন্ধ আছে"}
                        </span>
                      )}
                    </div>

                    {isOwner && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={mod.enabled}
                        disabled={!mod.allowed || isUpdating}
                        onClick={() => handleToggle(mod)}
                        data-testid={`module-switch-${mod.key}`}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                          mod.enabled ? "bg-primary" : "bg-muted"
                        } ${!mod.allowed || isUpdating ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        <span className="sr-only">{mod.nameBn}</span>
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            mod.enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
