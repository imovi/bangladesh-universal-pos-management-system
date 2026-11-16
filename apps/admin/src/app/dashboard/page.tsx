"use client";

import React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import {
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Clock,
  Package,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const { currentBranch } = useAuth();
  const { strings, locale } = useTranslation();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {locale === "bn" ? "ড্যাশবোর্ড ওভারভিউ" : "Dashboard Overview"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {currentBranch
                ? `${currentBranch.name} (${currentBranch.code})`
                : strings.common.allBranches}{" "}
              — {locale === "bn" ? "আজকের কার্যক্রম ও পরিসংখ্যান" : "Today's summary"}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/catalog/products">
              <Button size="sm" variant="outline" className="flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                <span>{strings.nav.products}</span>
              </Button>
            </Link>
            <Link href="/sales">
              <Button size="sm" className="flex items-center gap-1.5">
                <ShoppingCart className="h-4 w-4" />
                <span>{strings.nav.salesList}</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Today's Sales */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.todaySales}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">
                {formatMoney(0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {strings.dashboard.noSalesToday}
              </p>
            </CardContent>
          </Card>

          {/* Sales Count */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.salesCount}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <ShoppingCart className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "মোট ভাউচার সংখ্যা" : "Total transactions"}
              </p>
            </CardContent>
          </Card>

          {/* Low Stock Items */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.lowStockAlerts}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                0
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "সীমার নিচে থাকা পণ্য" : "Items below reorder limit"}
              </p>
            </CardContent>
          </Card>

          {/* Open Shifts */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {strings.dashboard.openShifts}
              </CardTitle>
              <div className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Clock className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "bn" ? "কাউন্টারে সক্রিয় শিফট" : "Active register shifts"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
