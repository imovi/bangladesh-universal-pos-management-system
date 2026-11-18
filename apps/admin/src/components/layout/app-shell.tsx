"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { NoAccess } from "@/components/common/no-access";
import { OfflineBackOfficePage } from "./offline-page";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/context";

interface AppShellProps {
  children: React.ReactNode;
  requiredPermission?: string;
}

export function AppShell({ children, requiredPermission }: AppShellProps) {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();
  const { strings } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof window !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && isOnline) {
    // If not authenticated and online, the AuthContext or page redirects to /login.
    // In the meantime, show loading.
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Offline Back Office View
  if (!isOnline) {
    return (
      <div className="min-h-screen flex bg-background">
        <div className="hidden md:block shrink-0">
          <Sidebar />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <Header onOpenMobile={() => setMobileOpen(true)} />
          <main className="flex-1 p-6">
            <OfflineBackOfficePage />
          </main>
        </div>
      </div>
    );
  }

  // Permission Gate
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 p-6">
          <NoAccess />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar />
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-50 flex h-full">
            <Sidebar onCloseMobile={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
