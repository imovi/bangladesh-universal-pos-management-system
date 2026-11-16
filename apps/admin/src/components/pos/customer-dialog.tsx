"use client";

import React, { useState } from "react";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { X, Search, UserPlus, Check, User } from "lucide-react";

export interface SelectedCustomer {
  id?: string;
  name: string;
  phone?: string;
  creditLimitMinor?: number;
  currentDueMinor?: number;
}

interface CustomerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: SelectedCustomer) => void;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

export function CustomerDialog({
  isOpen,
  onClose,
  onSelectCustomer,
  apiFetch,
}: CustomerDialogProps) {
  const { strings, locale } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Quick create fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (query: string) => {
    setSearchTerm(query);
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await apiFetch(`/customers?search=${encodeURIComponent(query.trim())}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.data?.items || data.items || []);
      }
    } catch {
      // Ignore
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) {
      setCreateError(locale === "bn" ? "নাম আবশ্যক" : "Name is required");
      return;
    }
    if (!phone.trim()) {
      setCreateError(locale === "bn" ? "ফোন নম্বর আবশ্যক" : "Phone number is required");
      return;
    }

    setIsCreating(true);
    try {
      const res = await apiFetch("/customers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const created = data.data;
        onSelectCustomer({
          id: created.id,
          name: created.name,
          phone: created.phone,
        });
        onClose();
      } else {
        setCreateError(data.error?.message || "Failed to create customer");
      }
    } catch (err: any) {
      setCreateError(err.message || "Failed to create customer");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelectWalkIn = () => {
    onSelectCustomer({
      name: strings.pos.walkInCustomer,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-dialog-title"
        className="bg-card text-card-foreground border border-border w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <h2 id="customer-dialog-title" className="text-base font-semibold tracking-tight">
              {strings.pos.customer}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Default Walk-in Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleSelectWalkIn}
            className="w-full flex items-center justify-between h-10 px-4 text-xs font-semibold border-dashed"
          >
            <span>{strings.pos.walkInCustomer}</span>
            <Check className="h-4 w-4 text-primary" />
          </Button>

          {/* Toggle Search vs Create */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-muted-foreground">
              {showCreate ? strings.pos.newCustomer : strings.pos.searchCustomer}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
              className="text-xs text-primary h-7 px-2"
            >
              {showCreate ? (
                <span>{strings.pos.searchCustomer}</span>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  <span>{strings.pos.newCustomer}</span>
                </>
              )}
            </Button>
          </div>

          {showCreate ? (
            /* Create Form */
            <form onSubmit={handleCreateCustomer} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cust-name" className="text-xs font-medium">
                  {strings.pos.customerName} *
                </Label>
                <Input
                  id="cust-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahim Ahmed"
                  className="h-9 text-xs"
                  data-testid="customer-name-input"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="cust-phone" className="text-xs font-medium">
                  {strings.pos.customerPhone} *
                </Label>
                <Input
                  id="cust-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01700000000"
                  className="h-9 text-xs font-mono"
                  data-testid="customer-phone-input"
                />
              </div>

              {createError && <p className="text-xs text-destructive">{createError}</p>}

              <Button
                type="submit"
                data-testid="save-customer-button"
                disabled={isCreating}
                className="w-full h-9 font-semibold text-xs mt-2"
              >
                {isCreating ? strings.common.loading : strings.pos.saveCustomer}
              </Button>
            </form>
          ) : (
            /* Search Input & Results */
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={strings.pos.searchCustomer}
                  className="pl-9 h-9 text-xs font-mono"
                  data-testid="customer-search-input"
                  autoFocus
                />
              </div>

              {searchResults.length > 0 && (
                <div className="divide-y divide-border border border-border rounded-lg max-h-48 overflow-y-auto">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelectCustomer({
                          id: c.id,
                          name: c.name,
                          phone: c.phone,
                          creditLimitMinor: Number(c.creditLimitMinor || 0),
                          currentDueMinor: Number(c.currentDueMinor || 0),
                        });
                        onClose();
                      }}
                      className="w-full text-left p-2.5 text-xs hover:bg-muted transition-colors flex justify-between items-center"
                    >
                      <div>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-muted-foreground font-mono text-[11px]">{c.phone}</div>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        {Number(c.currentDueMinor || 0) > 0 && (
                          <span className="text-[11px] font-mono font-semibold text-destructive">
                            {locale === "bn" ? "বকেয়া: " : "Due: "}{formatMoney(Number(c.currentDueMinor))}
                          </span>
                        )}
                        {Number(c.creditLimitMinor || 0) > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {locale === "bn" ? "সীমা: " : "Limit: "}{formatMoney(Number(c.creditLimitMinor))}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {searchTerm.length >= 2 && searchResults.length === 0 && !isSearching && (
                <div className="text-center py-4 text-xs text-muted-foreground">
                  {locale === "bn" ? "কোন ক্রেতা পাওয়া যায়নি" : "No customer found"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
