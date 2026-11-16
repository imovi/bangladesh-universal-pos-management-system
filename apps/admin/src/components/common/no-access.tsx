"use client";

import React from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";

export function NoAccess() {
  const { strings } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
        <ShieldAlert className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight mb-2">
        {strings.access.deniedTitle}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground mb-6">
        {strings.access.deniedMessage}
      </p>
      <Link href="/dashboard">
        <Button variant="outline" className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          <span>{strings.access.backToHome}</span>
        </Button>
      </Link>
    </div>
  );
}
