"use client";

import React, { useState, useEffect } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import {
  Loader2,
  AlertCircle,
  Eye,
  X,
  Activity,
} from "lucide-react";

interface AuditLogItem {
  id: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  ip?: string | null;
  createdAt: string;
}

export default function AuditLogsPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch } = useAuth();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalItems, setTotalItems] = useState(0);

  // Detail Modal
  const [activeLog, setActiveLog] = useState<AuditLogItem | null>(null);

  const loadAuditLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (entityFilter !== "all") params.set("entityType", entityFilter);

      const res = await apiFetch(`/audit-logs?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const items = Array.isArray(data) ? data : data.items || [];
        setLogs(items);
        const meta = json.meta?.pagination || data.pagination;
        if (meta) {
          setTotalItems(meta.total || items.length);
        } else {
          setTotalItems(items.length);
        }
      } else {
        const err = await res.json();
        setError(err.error?.message || err.message || "Failed to load audit logs");
      }
    } catch (err: any) {
      setError(err.message || "Network error loading audit logs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [page, pageSize, actionFilter, entityFilter]);

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const getActionBadgeVariant = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes("CREATE") || act.includes("OPEN")) return "success";
    if (act.includes("UPDATE") || act.includes("RECEIVE")) return "outline";
    if (act.includes("DELETE") || act.includes("VOID")) return "destructive";
    if (act.includes("CLOSE")) return "secondary";
    return "outline";
  };

  return (
    <PermissionGate permission="audit.read">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {strings.settings.auditTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.settings.auditDesc}
          </p>
        </div>

        {/* Global Error */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={locale === "bn" ? "অ্যাকশন ফিল্টার" : "Filter by action"}
              value={actionFilter}
              data-testid="audit-action-filter"
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 px-3 text-xs rounded-md border border-input bg-background"
            >
              <option value="all">{locale === "bn" ? "সব অ্যাকশন" : "All Actions"}</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="VOID">VOID</option>
              <option value="OPEN">OPEN</option>
              <option value="CLOSE">CLOSE</option>
            </select>

            <select
              aria-label={locale === "bn" ? "বিভাগ ফিল্টার" : "Filter by entity"}
              value={entityFilter}
              data-testid="audit-entity-filter"
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 px-3 text-xs rounded-md border border-input bg-background"
            >
              <option value="all">{locale === "bn" ? "সব বিভাগ" : "All Entities"}</option>
              <option value="sale">sale</option>
              <option value="shift">shift</option>
              <option value="product">product</option>
              <option value="branch">branch</option>
              <option value="user">user</option>
              <option value="role">role</option>
              <option value="customer">customer</option>
              <option value="supplier">supplier</option>
              <option value="tenant">tenant</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground">
            {locale === "bn" ? `মোট রেকর্ড: ${totalItems}` : `Total records: ${totalItems}`}
          </div>
        </div>

        {/* Audit Logs Table */}
        <Card className="shadow-xs border border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {strings.settings.noAuditLogs}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-3">{strings.settings.timestamp}</th>
                      <th className="px-4 py-3">{strings.settings.action}</th>
                      <th className="px-4 py-3">{strings.settings.entity}</th>
                      <th className="px-4 py-3 font-mono text-xs">Entity ID</th>
                      <th className="px-4 py-3">{strings.settings.actor}</th>
                      <th className="px-4 py-3 text-right">{strings.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors h-14">
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {formatTimestamp(log.createdAt)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={getActionBadgeVariant(log.action)} className="text-xs font-mono">
                            {log.action}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-semibold text-xs">
                          {log.entityType}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-[120px] truncate">
                          {log.entityId}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {log.actorUserId ? log.actorUserId.slice(0, 8) + "..." : "System"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`view-audit-${log.id}`}
                            onClick={() => setActiveLog(log)}
                            className="h-8 px-2 text-xs"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            <span>{strings.settings.details}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!isLoading && totalItems > 0 && (
              <div className="border-t border-border p-3">
                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={totalItems}
                  onPageChange={setPage}
                  onPageSizeChange={(newSize) => {
                    setPageSize(newSize);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal: Audit Log Details */}
        {activeLog && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="audit-modal-title"
              className="bg-card border border-border w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in"
            >
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  <h2 id="audit-modal-title" className="text-lg font-semibold tracking-tight">
                    {strings.settings.details}: {activeLog.action} {activeLog.entityType}
                  </h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActiveLog(null)}
                  className="h-8 w-8 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 font-mono">
                  <div>
                    <span className="text-muted-foreground">{strings.settings.timestamp}:</span>{" "}
                    <span className="font-semibold">{formatTimestamp(activeLog.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{strings.settings.action}:</span>{" "}
                    <span className="font-semibold">{activeLog.action}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{strings.settings.entity}:</span>{" "}
                    <span className="font-semibold">{activeLog.entityType} ({activeLog.entityId})</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{strings.settings.actor}:</span>{" "}
                    <span className="font-semibold">{activeLog.actorUserId || "System"}</span>
                  </div>
                </div>

                {/* Before / After state comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <span className="font-semibold text-muted-foreground">{strings.settings.beforeState}</span>
                    <pre className="p-3 rounded-lg bg-muted/30 border border-border overflow-x-auto text-[11px] font-mono max-h-64">
                      {activeLog.before
                        ? JSON.stringify(activeLog.before, null, 2)
                        : (locale === "bn" ? "পূর্বে কোন মান ছিল না" : "None")}
                    </pre>
                  </div>
                  <div className="space-y-1.5">
                    <span className="font-semibold text-muted-foreground">{strings.settings.afterState}</span>
                    <pre className="p-3 rounded-lg bg-muted/30 border border-border overflow-x-auto text-[11px] font-mono max-h-64">
                      {activeLog.after
                        ? JSON.stringify(activeLog.after, null, 2)
                        : (locale === "bn" ? "কোন পরবর্তী মান নেই" : "None")}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border flex justify-end bg-muted/20">
                <Button variant="outline" onClick={() => setActiveLog(null)}>
                  {strings.common.close}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
