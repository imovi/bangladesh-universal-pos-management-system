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
import {
  Shield,
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Percent,
} from "lucide-react";

interface RoleItem {
  id: string;
  name: string;
  isSystem: boolean;
  maxDiscountPercent: number;
  permissions: { permission: string }[] | string[];
  _count?: { userRoles: number };
}

interface PermissionDefinition {
  key: string;
  labelBn: string;
  labelEn: string;
}

interface PermissionGroup {
  groupBn: string;
  groupEn: string;
  permissions: PermissionDefinition[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    groupBn: "কাউন্টার ও বিক্রি (POS & Sales)",
    groupEn: "POS & Sales",
    permissions: [
      { key: "sale.read", labelBn: "বিক্রয় ইতিহাস দেখা", labelEn: "View sales history" },
      { key: "sale.create", labelBn: "কাউন্টারে বিক্রি ও বিল তৈরি করা", labelEn: "Create sales at counter" },
      { key: "sale.void", labelBn: "সম্পন্ন বিক্রি বাতিল (ভয়েড) করা", labelEn: "Void completed sales" },
      { key: "sale.discount_override", labelBn: "বিশেষ ছাড় বা ডিসকাউন্ট সীমা ওভাররাইড", labelEn: "Override discount limits" },
      { key: "sale.price_override", labelBn: "পণ্যের বিক্রয়মূল্য কাউন্টারে পরিবর্তন", labelEn: "Override unit sale prices" },
    ],
  },
  {
    groupBn: "ক্যাটালগ ও পণ্য (Catalog & Products)",
    groupEn: "Catalog & Products",
    permissions: [
      { key: "catalog.read", labelBn: "পণ্য ও ক্যাটাগরি তালিকা দেখা", labelEn: "View products & categories" },
      { key: "catalog.manage", labelBn: "পণ্য যোগ, সম্পাদনা ও ক্যাটাগরি নিয়ন্ত্রণ", labelEn: "Manage products & categories" },
    ],
  },
  {
    groupBn: "মজুদ ও ইনভেন্টরি (Inventory & Stock)",
    groupEn: "Inventory & Stock",
    permissions: [
      { key: "inventory.read", labelBn: "স্টক লেভেল ও মজুদ দেখা", labelEn: "View stock levels" },
      { key: "inventory.manage", labelBn: "প্রারম্ভিক স্টক ও মজুদ ব্যবস্থাপনা", labelEn: "Manage inventory & opening stock" },
      { key: "stock.adjust", labelBn: "স্টক সমন্বয় বা অ্যাডজাস্টমেন্ট এন্ট্রি", labelEn: "Create stock adjustments" },
    ],
  },
  {
    groupBn: "ক্রয় ও সরবরাহকারী (Purchasing & Suppliers)",
    groupEn: "Purchasing & Suppliers",
    permissions: [
      { key: "purchase.read", labelBn: "সরবরাহকারী ও ক্রয় আদেশ দেখা", labelEn: "View suppliers & purchase orders" },
      { key: "purchase.manage", labelBn: "নতুন ক্রয় আদেশ তৈরি ও সরবরাহকারী নিয়ন্ত্রণ", labelEn: "Manage POs & suppliers" },
      { key: "purchase.receive", labelBn: "পণ্য গ্রহণ বা জিআরএন এন্ট্রি", labelEn: "Receive goods (GRN)" },
    ],
  },
  {
    groupBn: "কাউন্টার ও শিফট (Registers & Shifts)",
    groupEn: "Registers & Shifts",
    permissions: [
      { key: "shift.manage", labelBn: "শিফট হিসাব ও রেজিস্টার পর্যবেক্ষণ", labelEn: "Manage shifts" },
      { key: "shift.open", labelBn: "কাউন্টার শিফট শুরু করা", labelEn: "Open register shift" },
      { key: "shift.close", labelBn: "কাউন্টার শিফট সমাপ্ত ও ক্যাশ মিলানো", labelEn: "Close register shift & cash reconcile" },
      { key: "register.manage", labelBn: "ক্যাশ রেজিস্টার কনফিগারেশন", labelEn: "Manage cash registers" },
    ],
  },
  {
    groupBn: "গ্রাহক (Customers)",
    groupEn: "Customers",
    permissions: [
      { key: "customer.read", labelBn: "গ্রাহক তালিকা ও বাকির হিসাব দেখা", labelEn: "View customers" },
      { key: "customer.manage", labelBn: "গ্রাহক যোগ ও তথ্য পরিবর্তন", labelEn: "Manage customers" },
    ],
  },
  {
    groupBn: "প্রশাসন ও সেটিংস (Administration & Settings)",
    groupEn: "Administration & Settings",
    permissions: [
      { key: "branch.read", labelBn: "শাখা তালিকা দেখা", labelEn: "View branches" },
      { key: "branch.manage", labelBn: "শাখা তৈরি ও কনফিগারেশন", labelEn: "Manage branches" },
      { key: "user.read", labelBn: "কর্মী তালিকা দেখা", labelEn: "View users & staff" },
      { key: "user.manage", labelBn: "কর্মী তৈরি, রোল ও শাখা নির্ধারণ", labelEn: "Manage users & staff" },
      { key: "role.read", labelBn: "রোল ও পারমিশন তালিকা দেখা", labelEn: "View roles & permissions" },
      { key: "role.manage", labelBn: "নতুন রোল তৈরি ও পারমিশন পরিবর্তন", labelEn: "Manage roles & permissions" },
      { key: "tenant.read", labelBn: "দোকানের সাধারণ সেটিংস দেখা", labelEn: "View shop settings" },
      { key: "tenant.update", labelBn: "দোকানের নিয়ম ও সেটিংস পরিবর্তন", labelEn: "Update shop settings" },
      { key: "audit.read", labelBn: "সিস্টেম অডিট লগ পর্যবেক্ষণ", labelEn: "View system audit logs" },
    ],
  },
  {
    groupBn: "রিপোর্ট ও বিশ্লেষণ (Reports & Analytics)",
    groupEn: "Reports & Analytics",
    permissions: [
      { key: "report.sales", labelBn: "বিক্রয় ও স্টক রিপোর্ট দেখা", labelEn: "View sales & stock reports" },
      { key: "report.financial", labelBn: "আর্থিক সারসংক্ষেপ রিপোর্ট", labelEn: "View financial reports" },
      { key: "report.profit", labelBn: "মুনাফা ও লাভ-লোকসান বিশ্লেষণ", labelEn: "View profit & loss reports" },
    ],
  },
];

export default function RolesSettingsPage() {
  const { strings, locale } = useTranslation();
  const { apiFetch } = useAuth();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formMaxDiscount, setFormMaxDiscount] = useState("5");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const loadRoles = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiFetch("/roles");
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const items = Array.isArray(data) ? data : data.items || [];
        setRoles(items);
      } else {
        const err = await res.json();
        setError(err.error?.message || err.message || "Failed to load roles");
      }
    } catch (err: any) {
      setError(err.message || "Network error loading roles");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const openCreateDialog = () => {
    setEditingRole(null);
    setFormName("");
    setFormMaxDiscount("5");
    setSelectedPermissions([
      "sale.read",
      "sale.create",
      "catalog.read",
      "customer.read",
      "customer.manage",
      "shift.open",
      "shift.close",
    ]);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (role: RoleItem) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormMaxDiscount(String(role.maxDiscountPercent ?? 0));
    const perms = Array.isArray(role.permissions)
      ? role.permissions.map((p) => (typeof p === "string" ? p : p.permission))
      : [];
    setSelectedPermissions(perms);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const toggleGroup = (group: PermissionGroup) => {
    const groupKeys = group.permissions.map((p) => p.key);
    const allSelected = groupKeys.every((k) => selectedPermissions.includes(k));
    if (allSelected) {
      setSelectedPermissions((prev) => prev.filter((k) => !groupKeys.includes(k)));
    } else {
      setSelectedPermissions((prev) => Array.from(new Set([...prev, ...groupKeys])));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const discountNum = Number(formMaxDiscount);
    if (isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
      setFormError(locale === "bn" ? "ডিসকাউন্ট সীমা ০ থেকে ১০০ এর মধ্যে হতে হবে" : "Max discount must be between 0 and 100");
      return;
    }

    if (!editingRole && !formName.trim()) {
      setFormError(locale === "bn" ? "রোলের নাম লিখুন" : "Role name required");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingRole) {
        const res = await apiFetch(`/roles/${editingRole.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: editingRole.isSystem ? undefined : formName.trim(),
            maxDiscountPercent: discountNum,
            permissions: selectedPermissions,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to update role");
        }
        setSuccessMessage(locale === "bn" ? "রোল সফলভাবে আপডেট হয়েছে" : "Role updated successfully");
      } else {
        const res = await apiFetch("/roles", {
          method: "POST",
          body: JSON.stringify({
            name: formName.trim(),
            maxDiscountPercent: discountNum,
            permissions: selectedPermissions,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to create role");
        }
        setSuccessMessage(locale === "bn" ? "নতুন রোল তৈরি হয়েছে" : "Role created successfully");
      }
      setIsDialogOpen(false);
      loadRoles();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRole = async (role: RoleItem) => {
    if (role.isSystem) return;
    const confirmText =
      locale === "bn"
        ? `আপনি কি নিশ্চিতভাবে "${role.name}" রোলটি মুছে ফেলতে চান?`
        : `Are you sure you want to delete role "${role.name}"?`;
    if (!window.confirm(confirmText)) return;

    try {
      const res = await apiFetch(`/roles/${role.id}`, { method: "DELETE" });
      if (res.ok) {
        setSuccessMessage(locale === "bn" ? "রোল মুছে ফেলা হয়েছে" : "Role deleted successfully");
        loadRoles();
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        const err = await res.json();
        alert(err.error?.message || err.message || "Failed to delete role");
      }
    } catch (err: any) {
      alert(err.message || "Network error deleting role");
    }
  };

  return (
    <PermissionGate permission="role.read">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strings.settings.rolesTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {strings.settings.rolesDesc}
            </p>
          </div>
          <Button
            onClick={openCreateDialog}
            data-testid="create-role-button"
            className="flex items-center gap-1.5 font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>{strings.settings.newRole}</span>
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

        {/* Roles Table */}
        <Card className="shadow-xs border border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : roles.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {locale === "bn" ? "কোন রোল পাওয়া যায়নি" : "No roles found"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-3">{strings.settings.roleName}</th>
                      <th className="px-4 py-3">{locale === "bn" ? "ধরণ" : "Type"}</th>
                      <th className="px-4 py-3">{strings.settings.maxDiscountPercent}</th>
                      <th className="px-4 py-3">{strings.settings.permissions}</th>
                      <th className="px-4 py-3 text-right">{strings.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm">
                    {roles.map((r) => {
                      const permCount = Array.isArray(r.permissions) ? r.permissions.length : 0;
                      return (
                        <tr key={r.id} className="hover:bg-muted/30 transition-colors h-14">
                          <td className="px-4 py-2 font-medium">
                            <div className="flex items-center gap-2">
                              {r.isSystem ? (
                                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                              ) : (
                                <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <span className="font-semibold">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            {r.isSystem ? (
                              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                {locale === "bn" ? "সিস্টেম রোল" : "System Role"}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                {locale === "bn" ? "কাস্টম রোল" : "Custom Role"}
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">
                            <span className="px-2 py-0.5 rounded-md bg-muted font-semibold">
                              {r.maxDiscountPercent}%
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {locale === "bn" ? `${permCount} টি অনুমতি` : `${permCount} permissions`}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid={`edit-role-${r.id}`}
                                onClick={() => openEditDialog(r)}
                                className="h-8 px-2 text-xs"
                              >
                                <Edit2 className="h-3.5 w-3.5 mr-1" />
                                <span>{strings.common.edit}</span>
                              </Button>
                              {!r.isSystem && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteRole(r)}
                                  aria-label={`${strings.common.delete}: ${r.name}`}
                                  className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal: Create or Edit Role */}
        {isDialogOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="role-modal-title"
              className="bg-card border border-border w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <h2 id="role-modal-title" className="text-lg font-semibold tracking-tight">
                    {editingRole ? strings.settings.editRole : strings.settings.newRole}
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

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-5 flex-1">
                {formError && (
                  <div role="alert" className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                    {formError}
                  </div>
                )}

                {editingRole?.isSystem && (
                  <div className="p-3 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg border border-amber-500/20">
                    {strings.settings.systemRoleNotice}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="roleNameInput">
                      {strings.settings.roleName} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="roleNameInput"
                      data-testid="role-name-input"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Senior Cashier"
                      disabled={Boolean(editingRole?.isSystem)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="roleMaxDiscountInput">
                      {strings.settings.maxDiscountPercent} <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="roleMaxDiscountInput"
                        data-testid="role-max-discount-input"
                        type="number"
                        min="0"
                        max="100"
                        value={formMaxDiscount}
                        onChange={(e) => setFormMaxDiscount(e.target.value)}
                        placeholder="0 - 100"
                        required
                        className="pr-8 font-mono"
                      />
                      <Percent className="h-4 w-4 absolute right-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {strings.settings.maxDiscountHelp}
                    </p>
                  </div>
                </div>

                {/* Permissions Groups Matrix */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <Label className="text-sm font-bold tracking-tight">
                      {strings.settings.permissions} ({selectedPermissions.length} নির্বাচিত)
                    </Label>
                  </div>

                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((grp) => {
                      const groupKeys = grp.permissions.map((p) => p.key);
                      const allSelected = groupKeys.every((k) => selectedPermissions.includes(k));

                      return (
                        <div key={grp.groupEn} className="border border-border rounded-xl p-3.5 space-y-2.5 bg-muted/10">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs tracking-tight">
                              {locale === "bn" ? grp.groupBn : grp.groupEn}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleGroup(grp)}
                              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              {allSelected
                                ? (locale === "bn" ? "সব মুছুন" : "Clear all")
                                : (locale === "bn" ? "সব নির্বাচন" : "Select all")}
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {grp.permissions.map((p) => {
                              const isChecked = selectedPermissions.includes(p.key);
                              return (
                                <label
                                  key={p.key}
                                  className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                                    isChecked
                                      ? "bg-primary/5 border-primary/30 text-foreground"
                                      : "border-border/60 hover:bg-muted/30 text-muted-foreground"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => togglePermission(p.key)}
                                    className="h-4 w-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-medium leading-tight">
                                      {locale === "bn" ? p.labelBn : p.labelEn}
                                    </div>
                                    <div className="font-mono text-[10px] text-muted-foreground/80 mt-0.5">
                                      {p.key}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-border flex justify-end gap-2 bg-muted/20">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  {strings.common.cancel}
                </Button>
                <Button
                  type="button"
                  data-testid="save-role-button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="font-semibold"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : strings.common.save}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
