"use client";

import React, { useEffect, useState } from "react";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Cloud, ShieldCheck, AlertTriangle, Clock, HardDrive, CheckCircle2 } from "lucide-react";

interface BackupsStatus {
  lastBackupAt: string | null;
  lastBackupSizeBytes: number | null;
  lastBackupFilename: string | null;
  encrypted: boolean;
  offServerConfigured: boolean;
  offServerWarning: string | null;
  lastRestoreDrillAt: string | null;
  lastRestoreDrillStatus: string | null;
}

export function BackupsCard() {
  const { strings } = useTranslation();
  const { user, apiFetch } = useAuth();
  const [data, setData] = useState<BackupsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Read-only card accessible exclusively by Owner
  const isOwner = Boolean(user?.isOwner || user?.roles?.includes("Owner"));

  useEffect(() => {
    if (!isOwner) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    async function loadStatus() {
      try {
        const res = await apiFetch("/settings/backups");
        if (res.ok) {
          const json = await res.json();
          if (mounted) setData(json.data || json);
        }
      } catch {
        // Silently handle if unconfigured or not permitted
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    loadStatus();
    return () => {
      mounted = false;
    };
  }, [isOwner, apiFetch]);

  if (!isOwner) return null;

  const formatDate = (isoString: string | null) => {
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(d);
    } catch {
      return isoString;
    }
  };

  const formatSize = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card className="border border-border/80 shadow-sm" data-testid="backups-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg font-semibold">{strings.settings.backupsTitle}</CardTitle>
        </div>
        <CardDescription>{strings.settings.backupsDesc}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground animate-pulse py-2">Loading backup status...</div>
        ) : (
          <>
            {/* Warning if no off-server replication */}
            {!data?.offServerConfigured && (
              <div
                className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-400"
                data-testid="offserver-warning-banner"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="text-sm font-medium">
                  {strings.settings.offServerWarning}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              {/* Last Backup Card */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{strings.settings.lastBackup}</span>
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {formatDate(data?.lastBackupAt ?? null) || strings.settings.noBackupsYet}
                </div>
                {data?.lastBackupSizeBytes ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-1 pt-0.5">
                    <HardDrive className="h-3 w-3" />
                    <span>{formatSize(data.lastBackupSizeBytes)}</span>
                    {data.encrypted && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                        Encrypted
                      </Badge>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Off-Server Copy Card */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Cloud className="h-3.5 w-3.5" />
                  <span>{strings.settings.offServerStatus}</span>
                </div>
                <div className="text-sm font-semibold">
                  {data?.offServerConfigured ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {strings.settings.offServerConfigured}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                      {strings.settings.offServerWarning}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Last Restore Drill Card */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>{strings.settings.lastRestoreDrill}</span>
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {formatDate(data?.lastRestoreDrillAt ?? null) || strings.settings.noRestoreDrillYet}
                </div>
                {data?.lastRestoreDrillStatus === "success" && (
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 pt-0.5">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>{strings.settings.restoreDrillSuccess}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
