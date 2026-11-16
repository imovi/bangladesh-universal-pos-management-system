"use client";

import React from "react";
import { useAuth } from "@/lib/auth-context";
import { NoAccess } from "./no-access";

interface PermissionGateProps {
  permission: string;
  children: React.ReactNode;
}

export function PermissionGate({ permission, children }: PermissionGateProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <NoAccess />;
  }

  return <>{children}</>;
}
