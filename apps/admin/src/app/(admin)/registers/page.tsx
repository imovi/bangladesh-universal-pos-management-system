"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Store,
  Plus,
  Edit2,
  RefreshCw,
  CheckCircle2,
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
        setErrorMessage("Failed to load registers");
      }
    } catch {
      setErrorMessage("Network connection error");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, branchFilter]);

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

    try {
      setModalLoading(true);
      if (!editingId) {
        const payload = {
          name: formData.name.trim(),
          code: formData.code.trim(),
          branchId: formData.branchId,
        };
        const validation = CreateRegisterSchema.safeParse(payload);
        if (!validation.success) {
          setModalError(validation.error.errors[0]?.message || "Validation failed");
          return;
        }

        const res = await apiFetch("/registers", {
          method: "POST",
          body: JSON.stringify(payload),
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
          setModalError(errJson.message || errJson.error?.message || "Failed to create register");
        }
      } else {
        const payload = {
          name: formData.name.trim(),
          code: formData.code.trim(),
          isActive: formData.isActive,
        };

        const res = await apiFetch(`/registers/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
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
          setModalError(errJson.message || errJson.error?.message || "Failed to update register");
        }
      }
    } catch {
      setModalError("Network connection error");
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            {strings.registers.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.registers.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchRegisters()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {strings.common.refresh}
          </Button>

          {hasPermission("register.manage") && (
            <Button size="sm" onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-1.5" />
              {strings.registers.addRegister}
            </Button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs">
        <div className="max-w-xs">
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
            {strings.registers.branch}
          </label>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            <option value="all">{strings.sales.allBranches}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="py-3 px-4">{strings.registers.registerName}</th>
                <th className="py-3 px-4">{strings.registers.registerCode}</th>
                <th className="py-3 px-4">{strings.registers.branch}</th>
                <th className="py-3 px-4 text-center">{strings.registers.status}</th>
                <th className="py-3 px-4 text-center">{strings.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    {strings.common.loading}
                  </td>
                </tr>
              ) : registers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    {strings.common.noData}
                  </td>
                </tr>
              ) : (
                registers.map((r) => {
                  const branchObj = branches.find((b) => b.id === r.branchId) || r.branch;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium text-foreground">{r.name}</td>
                      <td className="py-3 px-4 font-mono text-xs text-foreground">{r.code}</td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">
                        {branchObj?.name || "-"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={r.isActive ? "default" : "secondary"}
                          className={`text-xs font-normal ${
                            r.isActive
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.isActive ? strings.registers.active : strings.registers.inactive}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {hasPermission("register.manage") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => openEditModal(r)}
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            {strings.common.edit}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Modal (Create / Edit) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground">
              {editingId ? strings.registers.editRegister : strings.registers.addRegister}
            </h2>

            {modalSuccess ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {strings.registers.registerSaved}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {modalError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                    {modalError}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.registers.registerName} *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Counter 1 / Ground Floor"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    {strings.registers.registerCode} *
                  </label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g. POS-01"
                    required
                  />
                </div>

                {!editingId && (
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      {strings.registers.branch} *
                    </label>
                    <select
                      value={formData.branchId}
                      onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                      required
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {editingId && (
                  <div className="pt-2">
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                      />
                      <span>{strings.registers.active}</span>
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowModal(false)}
                    disabled={modalLoading}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button type="submit" disabled={modalLoading}>
                    {modalLoading ? strings.common.loading : strings.common.save}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
