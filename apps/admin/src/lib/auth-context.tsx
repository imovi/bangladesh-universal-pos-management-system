"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { env } from "@/env";

export interface BranchInfo {
  id: string;
  name: string;
  code: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  isOwner: boolean;
  branches: BranchInfo[];
  maxDiscountPercent?: number | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  currentBranch: BranchInfo | null;
  setCurrentBranch: (branch: BranchInfo | null) => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: { tenantSlug: string; email: string; password: string }) => Promise<{ success: boolean; error?: string; status?: number }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentBranch, setCurrentBranchState] = useState<BranchInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Schedule silent refresh ~1 minute before expiration (or 13 min into 15 min token)
  const scheduleSilentRefresh = useCallback((expiresInSeconds = 900) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const refreshDelayMs = Math.max((expiresInSeconds - 90) * 1000, 10000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        await executeRefreshToken();
      } catch {
        // Silent refresh failure will trigger on next 401
      }
    }, refreshDelayMs);
  }, []);

  const executeRefreshToken = async (): Promise<string | null> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pos-client": "admin",
          },
        });

        if (!res.ok) {
          setAccessToken(null);
          setUser(null);
          return null;
        }

        const body = await res.json();
        if (body.success && body.data?.accessToken) {
          const token = body.data.accessToken;
          setAccessToken(token);
          scheduleSilentRefresh(body.data.expiresIn || 900);
          return token;
        }
        return null;
      } catch {
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  };

  const fetchUserProfile = async (token: string): Promise<AuthUser | null> => {
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.success && json.data) {
        const u = json.data;
        const profile: AuthUser = {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          tenantId: u.tenantId,
          tenantName: u.tenantName,
          tenantSlug: u.tenantSlug,
          roles: u.roles || [],
          permissions: u.permissions || [],
          isOwner: u.isOwner ?? false,
          branches: u.branches || [],
          maxDiscountPercent: u.maxDiscountPercent !== undefined ? u.maxDiscountPercent : (u.isOwner ? null : 0),
        };
        setUser(profile);

        // Auto-select first branch or restore saved branch
        const savedBranchId = localStorage.getItem("pos_selected_branch_id");
        const found = profile.branches.find((b) => b.id === savedBranchId);
        const branchToSelect = found || profile.branches[0] || null;
        setCurrentBranchState(branchToSelect);
        if (branchToSelect) {
          localStorage.setItem("pos_selected_branch_id", branchToSelect.id);
        }
        return profile;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Initial session restoration on mount
  useEffect(() => {
    let isMounted = true;
    async function restoreSession() {
      setIsLoading(true);
      const token = await executeRefreshToken();
      if (token && isMounted) {
        await fetchUserProfile(token);
      }
      if (isMounted) {
        setIsLoading(false);
      }
    }
    restoreSession();
    return () => {
      isMounted = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const setCurrentBranch = (branch: BranchInfo | null) => {
    setCurrentBranchState(branch);
    if (branch) {
      localStorage.setItem("pos_selected_branch_id", branch.id);
    } else {
      localStorage.removeItem("pos_selected_branch_id");
    }
  };

  const login = async (credentials: { tenantSlug: string; email: string; password: string }) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pos-client": "admin",
        },
        body: JSON.stringify(credentials),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        return {
          success: false,
          error: body.error?.message || "Invalid credentials",
          status: res.status,
        };
      }

      const token = body.data.accessToken;
      setAccessToken(token);
      scheduleSilentRefresh(body.data.expiresIn || 900);

      // Fetch full user profile with branches
      await fetchUserProfile(token);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to log in" };
    }
  };

  const logout = async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pos-client": "admin",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch {
      // Ignore
    }
    setAccessToken(null);
    setUser(null);
    setCurrentBranchState(null);
    router.push("/login");
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    if (user.isOwner) return true;
    if (user.permissions.includes("*")) return true;
    return user.permissions.includes(permission);
  };

  const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
    const fullUrl = path.startsWith("http") ? path : `${env.NEXT_PUBLIC_API_URL}${path}`;
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");

    let activeToken = accessToken;
    if (!activeToken) {
      activeToken = await executeRefreshToken();
    }

    if (activeToken) {
      headers.set("Authorization", `Bearer ${activeToken}`);
    }

    let response = await fetch(fullUrl, { ...options, headers });

    // Handle 401 with silent token refresh once
    if (response.status === 401) {
      const newToken = await executeRefreshToken();
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        response = await fetch(fullUrl, { ...options, headers });
      } else {
        // Refresh failed, redirect to login
        setUser(null);
        setAccessToken(null);
        router.push(`/login?from=${encodeURIComponent(pathname || "/dashboard")}`);
      }
    }

    return response;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        currentBranch,
        setCurrentBranch,
        isLoading,
        isAuthenticated: !!user && !!accessToken,
        login,
        logout,
        hasPermission,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
