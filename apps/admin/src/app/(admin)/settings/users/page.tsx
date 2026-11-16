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
  Users,
  Plus,
  Edit2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Search,
} from "lucide-react";

interface RoleOption {
  id: string;
  name: string;
  maxDiscountPercent: number;
}

interface BranchOption {
  id: string;
  name: string;
  code: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  userRoles: { role: RoleOption }[];
  userBranches: { branch: BranchOption }[];
}

export default function UsersSettingsPage() {
  const { strings, locale } = useTranslation();
  const { user: currentLoggedInUser, apiFetch } = useAuth();

  const [users, setUsers] = useState<UserItem[]>([]);
  const [availableRoles, setAvailableRoles] = useState<RoleOption[]>([]);
  const [availableBranches, setAvailableBranches] = useState<BranchOption[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formSelectedRoles, setFormSelectedRoles] = useState<string[]>([]);
  const [formSelectedBranches, setFormSelectedBranches] = useState<string[]>([]);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [usersRes, rolesRes, branchesRes] = await Promise.all([
        apiFetch("/users?limit=100"),
        apiFetch("/roles"),
        apiFetch("/branches?limit=100"),
      ]);

      if (usersRes.ok) {
        const json = await usersRes.json();
        const data = json.data || json;
        const items = Array.isArray(data) ? data : data.items || [];
        setUsers(items);
      }
      if (rolesRes.ok) {
        const json = await rolesRes.json();
        const data = json.data || json;
        setAvailableRoles(Array.isArray(data) ? data : data.items || []);
      }
      if (branchesRes.ok) {
        const json = await branchesRes.json();
        const data = json.data || json;
        setAvailableBranches(Array.isArray(data) ? data : data.items || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load staff list");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateDialog = () => {
    setEditingUser(null);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setFormSelectedRoles(availableRoles.length > 0 ? [availableRoles[0].id] : []);
    setFormSelectedBranches(availableBranches.map((b) => b.id));
    setFormIsActive(true);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (u: UserItem) => {
    setEditingUser(u);
    setFormName(u.name);
    setFormEmail(u.email);
    setFormPassword("");
    setFormSelectedRoles(u.userRoles.map((ur) => ur.role.id));
    setFormSelectedBranches(u.userBranches.map((ub) => ub.branch.id));
    setFormIsActive(u.isActive);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const toggleFormRole = (roleId: string) => {
    setFormSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const toggleFormBranch = (branchId: string) => {
    setFormSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError(locale === "bn" ? "কর্মীর নাম লিখুন" : "User name required");
      return;
    }
    if (!editingUser && !formEmail.trim()) {
      setFormError(locale === "bn" ? "ইমেইল অ্যাড্রেস লিখুন" : "Email required");
      return;
    }
    if (!editingUser && (!formPassword || formPassword.length < 8)) {
      setFormError(
        locale === "bn"
          ? "পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে"
          : "Password must be at least 8 characters",
      );
      return;
    }
    if (formSelectedRoles.length === 0) {
      setFormError(
        locale === "bn"
          ? "অন্তত একটি রোল নির্বাচন করুন"
          : "Please select at least one role",
      );
      return;
    }

    // Protection check: Cannot deactivate oneself
    if (editingUser && editingUser.id === currentLoggedInUser?.id && !formIsActive) {
      setFormError(strings.settings.cannotDeactivateSelf);
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingUser) {
        const payload: any = {
          name: formName.trim(),
          roleIds: formSelectedRoles,
          branchIds: formSelectedBranches,
          isActive: formIsActive,
        };
        if (formPassword && formPassword.length >= 8) {
          payload.password = formPassword;
        }

        const res = await apiFetch(`/users/${editingUser.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to update user");
        }
        setSuccessMessage(
          locale === "bn" ? "কর্মী সফলভাবে আপডেট হয়েছে" : "User updated successfully",
        );
      } else {
        const res = await apiFetch("/users", {
          method: "POST",
          body: JSON.stringify({
            name: formName.trim(),
            email: formEmail.trim().toLowerCase(),
            password: formPassword,
            roleIds: formSelectedRoles,
            branchIds: formSelectedBranches,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || err.message || "Failed to create user");
        }
        setSuccessMessage(
          locale === "bn" ? "নতুন কর্মী সফলভাবে যুক্ত হয়েছে" : "User created successfully",
        );
      }
      setIsDialogOpen(false);
      loadData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole =
      selectedRoleFilter === "all" ||
      u.userRoles.some((ur) => ur.role.id === selectedRoleFilter);
    return matchesSearch && matchesRole;
  });

  return (
    <PermissionGate permission="user.read">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strings.settings.usersTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {strings.settings.usersDesc}
            </p>
          </div>
          <Button
            onClick={openCreateDialog}
            data-testid="create-user-button"
            className="flex items-center gap-1.5 font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>{strings.settings.newUser}</span>
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

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={locale === "bn" ? "নাম বা ইমেইল দিয়ে খুঁজুন..." : "Search by name or email..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs w-64"
              />
            </div>
            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-md border border-input bg-background"
            >
              <option value="all">{locale === "bn" ? "সব রোল" : "All Roles"}</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground">
            {locale === "bn" ? `মোট কর্মী: ${users.length}` : `Total staff: ${users.length}`}
          </div>
        </div>

        {/* Users Table */}
        <Card className="shadow-xs border border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {locale === "bn" ? "কোন কর্মী পাওয়া যায়নি" : "No users found"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-3">{strings.settings.userName}</th>
                      <th className="px-4 py-3">{strings.settings.userEmail}</th>
                      <th className="px-4 py-3">{locale === "bn" ? "রোল" : "Roles"}</th>
                      <th className="px-4 py-3">{locale === "bn" ? "শাখা সমূহ" : "Branches"}</th>
                      <th className="px-4 py-3">{strings.common.status}</th>
                      <th className="px-4 py-3 text-right">{strings.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors h-14">
                        <td className="px-4 py-2 font-medium">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary/70 shrink-0" />
                            <span className="font-semibold">{u.name}</span>
                            {u.id === currentLoggedInUser?.id && (
                              <Badge variant="outline" className="text-[10px] bg-muted px-1.5 py-0">
                                {locale === "bn" ? "আপনি" : "You"}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs font-mono text-muted-foreground">
                          {u.email}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {u.userRoles.map((ur) => (
                              <Badge
                                key={ur.role.id}
                                variant="outline"
                                className="text-xs bg-primary/5 text-primary border-primary/20"
                              >
                                {ur.role.name}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {u.userBranches.length === 0 ? (
                            <span>{locale === "bn" ? "সকল শাখা" : "All branches"}</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {u.userBranches.map((ub) => (
                                <Badge key={ub.branch.id} variant="outline" className="text-[11px]">
                                  {ub.branch.code}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {u.isActive ? (
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
                            data-testid={`edit-user-${u.id}`}
                            onClick={() => openEditDialog(u)}
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

        {/* Modal: Create or Edit User */}
        {isDialogOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-modal-title"
              className="bg-card border border-border w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in"
            >
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <h2 id="user-modal-title" className="text-lg font-semibold tracking-tight">
                    {editingUser ? strings.settings.editUser : strings.settings.newUser}
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

              <div className="p-6 overflow-y-auto space-y-4 flex-1">
                {formError && (
                  <div role="alert" className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                    {formError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="userNameInput">
                    {strings.settings.userName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="userNameInput"
                    data-testid="user-name-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Asif Mahmud"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="userEmailInput">
                    {strings.settings.userEmail} {!editingUser && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="userEmailInput"
                    data-testid="user-email-input"
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="e.g. asif@artisan.com"
                    disabled={Boolean(editingUser)}
                    required={!editingUser}
                    className={editingUser ? "bg-muted font-mono" : "font-mono"}
                  />
                  {editingUser && (
                    <p className="text-[11px] text-muted-foreground">
                      {locale === "bn" ? "ইমেইল অপরিবর্তনযোগ্য" : "Email address cannot be edited"}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="userPasswordInput">
                    {strings.settings.userPassword} {!editingUser && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="userPasswordInput"
                    data-testid="user-password-input"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={
                      editingUser
                        ? (locale === "bn" ? "পাসওয়ার্ড পরিবর্তন না করতে চাইলে খালি রাখুন" : "Leave blank to keep current password")
                        : (locale === "bn" ? "অন্তত ৮ অক্ষরের শক্তিশালী পাসওয়ার্ড" : "Minimum 8 characters")
                    }
                    required={!editingUser}
                  />
                </div>

                {/* Roles Selector */}
                <div className="space-y-2 pt-1">
                  <Label className="text-xs font-semibold">
                    {strings.settings.assignRole} <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {availableRoles.map((r) => {
                      const isChecked = formSelectedRoles.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? "bg-primary/5 border-primary/40 text-foreground font-semibold"
                              : "border-border text-muted-foreground hover:bg-muted/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleFormRole(r.id)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <div className="min-w-0">
                            <div>{r.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              Max disc: {r.maxDiscountPercent}%
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Branches Selector */}
                <div className="space-y-2 pt-1">
                  <Label className="text-xs font-semibold">
                    {strings.settings.assignBranches}
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {availableBranches.map((b) => {
                      const isChecked = formSelectedBranches.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? "bg-primary/5 border-primary/40 text-foreground font-semibold"
                              : "border-border text-muted-foreground hover:bg-muted/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleFormBranch(b.id)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <div className="min-w-0">
                            <div>{b.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {b.code}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Active Toggle */}
                {editingUser && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                    <div className="space-y-0.5">
                      <Label htmlFor="userActiveToggle" className="text-sm font-semibold cursor-pointer">
                        {strings.settings.userActive}
                      </Label>
                      {editingUser.id === currentLoggedInUser?.id && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          {strings.settings.cannotDeactivateSelf}
                        </p>
                      )}
                    </div>
                    <input
                      id="userActiveToggle"
                      data-testid="user-active-toggle"
                      type="checkbox"
                      checked={formIsActive}
                      disabled={editingUser.id === currentLoggedInUser?.id}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>
                )}
              </div>

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
                  data-testid="save-user-button"
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
