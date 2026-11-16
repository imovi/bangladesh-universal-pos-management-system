"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Store,
  Plus,
  Edit2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { CreateRegisterSchema } from "@universal-pos/shared";

interface RegisterRecord {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  branchId: string;
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdAt: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function RegistersPage() {
  const { apiFetch, hasPermission } = useAuth();
  const { strings } = useTranslation();

  const [registers, setRegisters] = useState<RegisterRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    branchId: "",
    isActive: true,
  });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState(false);

  // Load branches
  useEffect(() => {
    let isCurrent = true;
    async function loadBranches() {
      try {
        const res = await apiFetch("/branches");
        if (res.ok) {
          const json = await res.json();
          if (isCurrent) {
            const list = Array.isArray(json.data) ? json.data : (json.data?.items || []);
            setBranches(list);
            if (list.length > 0 && !formData.branchId) {
              setFormData((f) => ({ ...f, branchId: list[0].id }));
            }
          }
        }
      } catch {
        // Ignore
      }
    }
    loadBranches();
    return () => {
      isCurrent = false;
    };
  }, [apiFetch, formData.branchId]);

  const fetchRegisters = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const queryParams = new URLSearchParams();
      if (branchFilter && branchFilter !== "all") {
        queryParams.set("branchId", branchFilter);
      }

      const res = await apiFetch(`/registers?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
        setRegisters(items);
      } else {
        setErrorMessage(strings.common.error);
      }
    } catch {
      setErrorMessage(strings.common.error);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, branchFilter, strings.common.error]);

  useEffect(() => {
    fetchRegisters();
  }, [fetchRegisters]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({
      name: "",
      code: "",
      branchId: branches[0]?.id || "",
      isActive: true,
    });
    setModalError(null);
    setModalSuccess(false);
    setShowModal(true);
  };

  const openEditModal = (r: RegisterRecord) => {
    setEditingId(r.id);
    setFormData({
      name: r.name,
      code: r.code,
      branchId: r.branchId,
      isActive: r.isActive,
    });
    setModalError(null);
    setModalSuccess(false);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const validation = CreateRegisterSchema.safeParse({
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      branchId: formData.branchId,
      isActive: formData.isActive,
    });

    if (!validation.success) {
      const issue = validation.error.issues[0];
      setModalError(issue.message || "Invalid input data");
      return;
    }

    try {
      setModalLoading(true);
      const url = editingId ? `/registers/${editingId}` : "/registers";
      const method = editingId ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(validation.data),
      });

      if (res.ok) {
        setModalSuccess(true);
        setTimeout(() => {
          setShowModal(false);
          setModalSuccess(false);
          fetchRegisters();
        }, 800);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setModalError(errJson.message || errJson.error?.message || "Failed to save register");
      }
    } catch {
      setModalError(strings.common.error);
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span>{strings.registers.title}</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {strings.registers.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission("register.manage") && (
            <Button onClick={openCreateModal} className="h-9">
              <Plus className="h-4 w-4 mr-1.5" />
              <span>{strings.registers.addRegister}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
        <div className="max-w-xs">
          <Label className="text-xs font-semibold text-muted-foreground block mb-1.5">
            {strings.registers.branch}
          </Label>
          <Select
            value={branchFilter}
            onValueChange={(val) => setBranchFilter(val)}
          >
            <SelectTrigger className="h-9 text-xs sm:text-sm" aria-label={strings.selectEmpty.allBranches}>
              <SelectValue placeholder={strings.selectEmpty.allBranches} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs sm:text-sm font-medium">
                {strings.selectEmpty.allBranches}
              </SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id} className="text-xs sm:text-sm">
                  {b.name} ({b.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.registers.registerName}</TableHead>
              <TableHead className="w-40">{strings.registers.registerCode}</TableHead>
              <TableHead className="w-56">{strings.registers.branch}</TableHead>
              <TableHead className="text-center w-28">{strings.registers.status}</TableHead>
              <TableHead className="text-right w-20">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  {strings.common.loading}
                </TableCell>
              </TableRow>
            ) : registers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-xs sm:text-sm">
                  {strings.common.noData}
                </TableCell>
              </TableRow>
            ) : (
              registers.map((r) => {
                const branchObj = branches.find((b) => b.id === r.branchId) || r.branch;
                return (
                  <TableRow key={r.id} className="hover:bg-muted/30 h-[56px] transition-colors">
                    <TableCell className="font-semibold text-foreground text-xs sm:text-sm">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground font-semibold">{r.code}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {branchObj?.name || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={r.isActive ? "success" : "secondary"}
                        className="text-[11px]"
                      >
                        {r.isActive ? strings.registers.active : strings.registers.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {hasPermission("register.manage") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => openEditModal(r)}
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          <span>{strings.common.edit}</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingId ? strings.registers.editRegister : strings.registers.addRegister}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {modalSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{strings.registers.registerSaved}</span>
              </div>
            )}

            {modalError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="regName" className="text-xs font-semibold">
                {strings.registers.registerName} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="regName"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Counter 1"
                required
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regCode" className="text-xs font-semibold">
                {strings.registers.registerCode} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="regCode"
                value={formData.code}
                onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. REG-01"
                required
                className="h-9 text-sm font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regBranch" className="text-xs font-semibold">
                {strings.registers.branch} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.branchId}
                onValueChange={(val) => setFormData((f) => ({ ...f, branchId: val }))}
              >
                <SelectTrigger id="regBranch" className="h-9 text-xs sm:text-sm">
                  <SelectValue placeholder={strings.selectEmpty.chooseBranch} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs sm:text-sm">
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="regActive"
                checked={formData.isActive}
                onChange={(e) => setFormData((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-input cursor-pointer"
              />
              <Label htmlFor="regActive" className="text-xs font-medium cursor-pointer">
                {strings.common.active}
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                {strings.common.cancel}
              </Button>
              <Button type="submit" disabled={modalLoading}>
                {modalLoading ? strings.common.loading : strings.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
