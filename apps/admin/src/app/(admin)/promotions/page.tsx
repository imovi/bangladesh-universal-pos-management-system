"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTablePagination } from "@/components/common/data-table-pagination";
import { Plus, Search, Tag, Edit2, Play, Pause, Square, Copy, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function PromotionsPage() {
  const router = useRouter();
  const { strings } = useTranslation();
  const { apiFetch } = useAuth();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: promotionsData, isLoading } = useQuery({
    queryKey: ["promotions-list", page, pageSize, searchTerm, selectedStatus, selectedType],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", pageSize.toString());
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (selectedStatus !== "all") params.set("status", selectedStatus);
      if (selectedType !== "all") params.set("type", selectedType);

      const res = await apiFetch(`/promotions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load promotions");
      return res.json();
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/promotions/${id}/pause`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to pause");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions-list"] });
    },
    onError: (err: any) => setActionError(err.message),
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/promotions/${id}/resume`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to resume");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions-list"] });
    },
    onError: (err: any) => setActionError(err.message),
  });

  const endMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/promotions/${id}/end`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to end");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions-list"] });
    },
    onError: (err: any) => setActionError(err.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/promotions/${id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to duplicate");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["promotions-list"] });
      if (data?.id) {
        router.push(`/promotions/${data.id}`);
      }
    },
    onError: (err: any) => setActionError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/promotions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || strings.promotions.cannotDeleteUsedOrEnded);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions-list"] });
    },
    onError: (err: any) => setActionError(err.message),
  });

  const promotions = promotionsData?.data || [];
  const meta = promotionsData?.meta || { total: 0, totalPages: 1 };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">{strings.promotions.statuses.active}</Badge>;
      case "paused":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{strings.promotions.statuses.paused}</Badge>;
      case "ended":
        return <Badge variant="outline" className="text-muted-foreground">{strings.promotions.statuses.ended}</Badge>;
      case "draft":
      default:
        return <Badge variant="outline" className="border-dashed">{strings.promotions.statuses.draft}</Badge>;
    }
  };

  const getTypeLabel = (type: string) => {
    return strings.promotions.types[type as keyof typeof strings.promotions.types] || type;
  };

  const formatTarget = (targets: any) => {
    if (!targets || !targets.targetType || targets.targetType === "ALL") {
      return strings.promotions.targets.ALL;
    }
    const count = targets.targetIds?.length || 0;
    const label = strings.promotions.targets[targets.targetType as keyof typeof strings.promotions.targets] || targets.targetType;
    return count > 0 ? `${label} (${count})` : label;
  };

  const formatTimeWindow = (start?: string | null, end?: string | null) => {
    if (!start && !end) return "-";
    const s = start ? new Date(start).toLocaleDateString() : "";
    const e = end ? new Date(end).toLocaleDateString() : "";
    if (s && e) return `${s} - ${e}`;
    if (s) return `${s} ~`;
    return `~ ${e}`;
  };

  return (
    <PermissionGate permission="promotion.view">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{strings.promotions.title}</h1>
            <p className="text-muted-foreground text-sm">{strings.promotions.subtitle}</p>
          </div>
          <PermissionGate permission="promotion.manage">
            <Link href="/promotions/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {strings.promotions.newPromotion}
              </Button>
            </Link>
          </PermissionGate>
        </div>

        {actionError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md">
            {actionError}
          </div>
        )}

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={strings.promotions.name}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>

              <div className="w-full sm:w-48">
                <Select
                  value={selectedStatus}
                  onValueChange={(val) => {
                    setSelectedStatus(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={strings.promotions.filterStatus} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{strings.promotions.allStatuses}</SelectItem>
                    <SelectItem value="active">{strings.promotions.statuses.active}</SelectItem>
                    <SelectItem value="draft">{strings.promotions.statuses.draft}</SelectItem>
                    <SelectItem value="paused">{strings.promotions.statuses.paused}</SelectItem>
                    <SelectItem value="ended">{strings.promotions.statuses.ended}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full sm:w-56">
                <Select
                  value={selectedType}
                  onValueChange={(val) => {
                    setSelectedType(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={strings.promotions.filterType} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{strings.promotions.allTypes}</SelectItem>
                    <SelectItem value="PERCENT_OFF">{strings.promotions.types.PERCENT_OFF}</SelectItem>
                    <SelectItem value="AMOUNT_OFF">{strings.promotions.types.AMOUNT_OFF}</SelectItem>
                    <SelectItem value="FIXED_PRICE">{strings.promotions.types.FIXED_PRICE}</SelectItem>
                    <SelectItem value="BUY_X_GET_Y">{strings.promotions.types.BUY_X_GET_Y}</SelectItem>
                    <SelectItem value="BUNDLE_PRICE">{strings.promotions.types.BUNDLE_PRICE}</SelectItem>
                    <SelectItem value="BILL_THRESHOLD">{strings.promotions.types.BILL_THRESHOLD}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{strings.promotions.name}</TableHead>
                    <TableHead>{strings.promotions.type}</TableHead>
                    <TableHead>{strings.promotions.targets.targetType}</TableHead>
                    <TableHead>{strings.promotions.timeWindow}</TableHead>
                    <TableHead className="text-center">{strings.promotions.uses}</TableHead>
                    <TableHead className="text-right">{strings.promotions.discountGiven}</TableHead>
                    <TableHead className="text-center">{strings.promotions.status}</TableHead>
                    <TableHead className="text-right">{strings.promotions.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                        {strings.common.loading}
                      </TableCell>
                    </TableRow>
                  ) : promotions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                        <Tag className="mx-auto h-8 w-8 mb-2 opacity-50" />
                        <p>{strings.promotions.noPromotionsFound}</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    promotions.map((promo: any) => {
                      const isUsedOrEnded = promo.status === "ended" || promo.totalUses > 0;
                      return (
                        <TableRow key={promo.id}>
                          <TableCell className="font-medium">
                            <Link href={`/promotions/${promo.id}`} className="hover:underline text-primary">
                              {promo.name}
                            </Link>
                            {promo.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">
                                {promo.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{getTypeLabel(promo.type)}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatTarget(promo.targets)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimeWindow(promo.startDate, promo.endDate)}
                          </TableCell>
                          <TableCell className="text-center text-sm font-mono">
                            {promo.totalUses}
                            {promo.conditions?.usageLimitTotal ? ` / ${promo.conditions.usageLimitTotal}` : ""}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(Number(promo.totalDiscountMinor || 0))}
                          </TableCell>
                          <TableCell className="text-center">
                            {getStatusBadge(promo.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link href={`/promotions/${promo.id}`}>
                                <Button variant="ghost" size="icon" title={strings.promotions.editPromotion}>
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </Link>

                              <PermissionGate permission="promotion.manage">
                                {promo.status === "active" ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={strings.promotions.pause}
                                    onClick={() => pauseMutation.mutate(promo.id)}
                                  >
                                    <Pause className="h-4 w-4 text-amber-600" />
                                  </Button>
                                ) : promo.status === "paused" ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={strings.promotions.resume}
                                    onClick={() => resumeMutation.mutate(promo.id)}
                                  >
                                    <Play className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                ) : null}

                                {promo.status !== "ended" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={strings.promotions.end}
                                    onClick={() => {
                                      if (confirm(strings.promotions.confirmEnd)) {
                                        endMutation.mutate(promo.id);
                                      }
                                    }}
                                  >
                                    <Square className="h-4 w-4 text-slate-500" />
                                  </Button>
                                )}

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={strings.promotions.duplicate}
                                  onClick={() => duplicateMutation.mutate(promo.id)}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>

                                {!isUsedOrEnded && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={strings.promotions.delete}
                                    onClick={() => {
                                      if (confirm(strings.promotions.confirmDelete)) {
                                        deleteMutation.mutate(promo.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </PermissionGate>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <DataTablePagination
              page={page}
              pageSize={pageSize}
              total={meta.total}
              onPageChange={setPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPage(1);
              }}
            />
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}
