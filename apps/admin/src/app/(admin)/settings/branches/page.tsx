"use client";

import React, { useState, useEffect } from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Edit2, Loader2, AlertCircle, Building2, Phone, MapPin, X, CheckCircle2 } from "lucide-react";

interface BranchItem {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function BranchesSettingsPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch } = useAuth();
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadBranches = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiFetch("/branches?limit=100");
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const items = Array.isArray(data) ? data : data.items || [];
        setBranches(items);
      } else {
        const err = await res.json();
        setError(err.error?.message || err.message || "Failed to load branches");
      }
    } catch (err: any) {
      setError(err.message || "Network error loading branches");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const openCreateDialog = () => {
    setEditingBranch(null);
    setFormName("");
    setFormCode("");
    setFormAddress("");
    setFormPhone("");
    setFormIsActive(true);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (branch: BranchItem) => {
    setEditingBranch(branch);
    setFormName(branch.name);
    setFormCode(branch.code);
    setFormAddress(branch.address || "");
    setFormPhone(branch.phone || "");
    setFormIsActive(branch.isActive);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formName.trim()) {
      setFormError(locale === "bn" ? "শাখার নাম লিখুন" : "Branch name required");
      return;
    }
    if (!editingBranch && !formCode.trim()) {
      setFormError(locale === "bn" ? "শাখা কোড আবশ্যক" : "Branch code required");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingBranch) {
        const res = await apiFetch(`/branches/${editingBranch.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: formName.trim(),
            address: formAddress.trim() || undefined,
            phone: formPhone.trim() || undefined,
            isActive: formIsActive,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to update branch");
        }
        setSuccessMessage(locale === "bn" ? "শাখা সফলভাবে আপডেট হয়েছে" : "Branch updated successfully");
      } else {
        const res = await apiFetch("/branches", {
          method: "POST",
          body: JSON.stringify({
            name: formName.trim(),
            code: formCode.trim().toUpperCase(),
            address: formAddress.trim() || undefined,
            phone: formPhone.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to create branch");
        }
        setSuccessMessage(locale === "bn" ? "নতুন শাখা তৈরি হয়েছে" : "Branch created successfully");
      }
      setIsDialogOpen(false);
      loadBranches();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredBranches = branches.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      (b.phone && b.phone.includes(search)),
  );

  return (
    <PermissionGate permission="branch.read">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strings.settings.branchesTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {strings.settings.branchesDesc}
            </p>
          </div>
          <Button
            onClick={openCreateDialog}
            data-testid="create-branch-button"
            className="flex items-center gap-1.5 font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>{strings.settings.newBranch}</span>
          </Button>
        </div>

        {/* Success Alert */}
        {successMessage && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

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

        {/* Filter bar */}
        <div className="flex items-center justify-between gap-4">
          <Input
            placeholder={locale === "bn" ? "শাখার নাম বা কোড দিয়ে খুঁজুন..." : "Search by name or code..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-9 text-xs"
          />
          <div className="text-xs text-muted-foreground">
            {locale === "bn" ? `মোট শাখা: ${branches.length}` : `Total branches: ${branches.length}`}
          </div>
        </div>

        {/* Branches Table */}
        <Card className="shadow-xs border border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredBranches.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {locale === "bn" ? "কোন শাখা পাওয়া যায়নি" : "No branches found"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-3">{strings.settings.branchName}</th>
                      <th className="px-4 py-3">{strings.settings.branchCode}</th>
                      <th className="px-4 py-3">{strings.settings.branchPhone}</th>
                      <th className="px-4 py-3">{strings.settings.branchAddress}</th>
                      <th className="px-4 py-3">{strings.common.status}</th>
                      <th className="px-4 py-3 text-right">{strings.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm">
                    {filteredBranches.map((b) => (
                      <tr key={b.id} className="hover:bg-muted/30 transition-colors h-14">
                        <td className="px-4 py-2 font-medium">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary/70 shrink-0" />
                            <span className="font-semibold">{b.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{b.code}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {b.phone ? (
                            <div className="flex items-center gap-1 font-mono">
                              <Phone className="h-3 w-3" />
                              <span>{b.phone}</span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">
                          {b.address ? (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{b.address}</span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {b.isActive ? (
                            <Badge variant="success" className="text-xs">
                              {strings.common.active}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              {strings.common.inactive}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`edit-branch-${b.id}`}
                            onClick={() => openEditDialog(b)}
                            className="h-8 px-2 text-xs"
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            <span>{strings.common.edit}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal: Create or Edit Branch */}
        {isDialogOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="branch-modal-title"
              className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 id="branch-modal-title" className="text-lg font-semibold tracking-tight">
                    {editingBranch ? strings.settings.editBranch : strings.settings.newBranch}
                  </h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsDialogOpen(false)}
                  className="h-8 w-8 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {formError && (
                <div role="alert" className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="branchNameInput">
                    {strings.settings.branchName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="branchNameInput"
                    data-testid="branch-name-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Dhanmondi Branch"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="branchCodeInput">
                    {strings.settings.branchCode} {!editingBranch && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="branchCodeInput"
                    data-testid="branch-code-input"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="e.g. DHN-01"
                    disabled={Boolean(editingBranch)}
                    required={!editingBranch}
                    className={editingBranch ? "bg-muted font-mono" : "font-mono"}
                  />
                  {editingBranch && (
                    <p className="text-[11px] text-muted-foreground">
                      {locale === "bn" ? "শাখা কোড অপরিবর্তনযোগ্য" : "Branch code cannot be edited"}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="branchPhoneInput">{strings.settings.branchPhone}</Label>
                  <Input
                    id="branchPhoneInput"
                    data-testid="branch-phone-input"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="e.g. 01711000000"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="branchAddressInput">{strings.settings.branchAddress}</Label>
                  <textarea
                    id="branchAddressInput"
                    data-testid="branch-address-input"
                    rows={2}
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="e.g. Road 27, Dhanmondi, Dhaka"
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                {editingBranch && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                    <Label htmlFor="branchActiveToggle" className="text-sm font-semibold cursor-pointer">
                      {strings.settings.branchActive}
                    </Label>
                    <input
                      id="branchActiveToggle"
                      data-testid="branch-active-toggle"
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    />
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-2 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                    disabled={isSubmitting}
                  >
                    {strings.common.cancel}
                  </Button>
                  <Button
                    type="submit"
                    data-testid="save-branch-button"
                    disabled={isSubmitting}
                    className="font-semibold"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : strings.common.save}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
