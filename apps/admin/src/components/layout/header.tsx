"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Menu,
  Moon,
  Sun,
  Globe,
  Building2,
  LogOut,
  ChevronDown,
} from "lucide-react";

export function Header({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { user, currentBranch, setCurrentBranch, logout } = useAuth();
  const { locale, setLocale, strings } = useTranslation();
  const { theme, setTheme } = useTheme();

  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const branches = user?.branches || [];

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur px-4 md:px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Left: Mobile hamburger + Branch selector */}
      <div className="flex items-center gap-3">
        <Button
          data-testid="mobile-menu-button"
          variant="ghost"
          size="icon"
          onClick={onOpenMobile}
          className="md:hidden h-9 w-9"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Branch Selector */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsBranchMenuOpen(!isBranchMenuOpen)}
            className="flex items-center gap-2 h-9 px-3 text-xs md:text-sm font-medium"
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold truncate max-w-[140px] md:max-w-[220px]">
              {currentBranch ? `${currentBranch.code} - ${currentBranch.name}` : strings.common.allBranches}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />
          </Button>

          {isBranchMenuOpen && (
            <div
              className="absolute left-0 mt-1.5 w-64 rounded-lg border border-border bg-card shadow-lg p-1.5 z-50 text-sm"
              onMouseLeave={() => setIsBranchMenuOpen(false)}
            >
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {locale === "bn" ? "শাখা পরিবর্তন করুন" : "Select Branch"}
              </div>

              {/* All branches option if user is owner */}
              {user?.isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setCurrentBranch(null);
                    setIsBranchMenuOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted text-xs flex items-center justify-between transition-colors"
                >
                  <span className={!currentBranch ? "font-bold text-primary" : ""}>
                    {strings.common.allBranches}
                  </span>
                </button>
              )}

              {branches.map((b) => {
                const isSelected = currentBranch?.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setCurrentBranch(b);
                      setIsBranchMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted text-xs flex items-center justify-between transition-colors"
                  >
                    <span className={isSelected ? "font-bold text-primary truncate" : "truncate"}>
                      {b.code} - {b.name}
                    </span>
                    {isSelected && <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Active</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Controls: Language, Theme, User Menu */}
      <div className="flex items-center gap-2">
        {/* Language Switcher */}
        <Button
          data-testid="language-toggle"
          variant="ghost"
          size="sm"
          onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
          className="flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold"
          aria-label={strings.language.toggle}
        >
          <Globe className="h-4 w-4" />
          <span>{locale === "bn" ? "English" : "বাংলা"}</span>
        </Button>

        {/* Theme Switcher */}
        <Button
          data-testid="theme-toggle"
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-8 w-8"
          aria-label={strings.theme.toggle}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* User Menu */}
        <div className="relative ml-1">
          <Button
            data-testid="user-menu-button"
            variant="ghost"
            size="sm"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 h-9 px-2 hover:bg-muted"
          >
            <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : "U"}
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-semibold leading-tight truncate max-w-[110px]">
                {user?.name || "User"}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {user?.roles?.[0] || (user?.isOwner ? "Owner" : "Staff")}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
          </Button>

          {isUserMenuOpen && (
            <div
              className="absolute right-0 mt-1.5 w-56 rounded-lg border border-border bg-card shadow-lg p-1.5 z-50 text-sm"
              onMouseLeave={() => setIsUserMenuOpen(false)}
            >
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="font-semibold text-xs truncate">{user?.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
                <div className="mt-1">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {user?.isOwner ? "System Owner" : user?.roles?.join(", ") || "User"}
                  </Badge>
                </div>
              </div>

              <button
                data-testid="logout-button"
                type="button"
                onClick={logout}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-destructive/10 text-xs text-destructive flex items-center gap-2 transition-colors font-medium"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{strings.auth.signOut}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
