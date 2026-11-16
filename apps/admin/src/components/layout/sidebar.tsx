"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Shirt,
  Boxes,
  Truck,
  Receipt,
  BarChart3,
  Settings,
  Store,
} from "lucide-react";

interface NavItem {
  titleKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  subItems?: Array<{ titleKey: string; href: string; permission?: string }>;
}

export function Sidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const pathname = usePathname();
  const { hasPermission, user } = useAuth();
  const { strings } = useTranslation();

  const navItems: NavItem[] = [
    {
      titleKey: "dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      permission: "sale.read",
    },
    {
      titleKey: "catalog",
      href: "/catalog/products",
      icon: Shirt,
      permission: "catalog.read",
      subItems: [
        { titleKey: "products", href: "/catalog/products", permission: "catalog.read" },
        { titleKey: "categories", href: "/catalog/categories", permission: "catalog.read" },
      ],
    },
    {
      titleKey: "inventory",
      href: "/inventory/stock",
      icon: Boxes,
      permission: "inventory.read",
      subItems: [
        { titleKey: "stockLevels", href: "/inventory/stock", permission: "inventory.read" },
        { titleKey: "lowStock", href: "/inventory/low-stock", permission: "inventory.read" },
        { titleKey: "adjustments", href: "/inventory/adjustments", permission: "stock.adjust" },
        { titleKey: "openingStock", href: "/inventory/opening", permission: "inventory.manage" },
      ],
    },
    {
      titleKey: "purchasing",
      href: "/purchasing/suppliers",
      icon: Truck,
      permission: "purchase.read",
      subItems: [
        { titleKey: "suppliers", href: "/purchasing/suppliers", permission: "purchase.read" },
        { titleKey: "purchaseOrders", href: "/purchasing/orders", permission: "purchase.read" },
        { titleKey: "goodsReceipts", href: "/purchasing/receipts", permission: "purchase.read" },
      ],
    },
    {
      titleKey: "sales",
      href: "/sales",
      icon: Receipt,
      permission: "sale.read",
      subItems: [
        { titleKey: "salesList", href: "/sales", permission: "sale.read" },
        { titleKey: "shifts", href: "/shifts", permission: "shift.manage" },
        { titleKey: "customers", href: "/customers", permission: "customer.read" },
      ],
    },
    {
      titleKey: "reports",
      href: "/reports/sales",
      icon: BarChart3,
      permission: "report.sales",
      subItems: [
        { titleKey: "salesReports", href: "/reports/sales", permission: "report.sales" },
        { titleKey: "stockReports", href: "/reports/stock", permission: "report.sales" },
        { titleKey: "profitReports", href: "/reports/profit", permission: "report.profit" },
      ],
    },
    {
      titleKey: "settings",
      href: "/settings/shop",
      icon: Settings,
      permission: "tenant.read",
      subItems: [
        { titleKey: "shopSettings", href: "/settings/shop", permission: "tenant.read" },
        { titleKey: "branches", href: "/settings/branches", permission: "branch.read" },
        { titleKey: "usersAndRoles", href: "/settings/users", permission: "user.read" },
        { titleKey: "auditLogs", href: "/settings/audit", permission: "audit.read" },
      ],
    },
  ];

  // Filter items based on permissions
  const filteredNav = navItems.filter((item) => {
    if (item.permission && !hasPermission(item.permission)) {
      return false;
    }
    return true;
  });

  return (
    <aside className="w-64 flex flex-col h-full bg-card border-r border-border select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-border gap-2.5">
        <Store className="h-6 w-6 text-primary shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-base tracking-tight truncate">
            {user?.tenantName || strings.common.appName}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {user?.tenantSlug}
          </span>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1.5" aria-label="Main Navigation">
        {filteredNav.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href.split("/")[1] ? `/${item.href.split("/")[1]}` : item.href));
          const navTitle = (strings.nav as any)[item.titleKey] || item.titleKey;

          return (
            <div key={item.href} className="space-y-1">
              <Link
                href={item.href}
                onClick={onCloseMobile}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{navTitle}</span>
              </Link>

              {/* Sub-items if active or parent is active */}
              {item.subItems && isActive && (
                <div className="pl-9 pr-2 py-1 space-y-1">
                  {item.subItems
                    .filter((sub) => !sub.permission || hasPermission(sub.permission))
                    .map((sub) => {
                      const isSubActive = pathname === sub.href;
                      const subTitle = (strings.nav as any)[sub.titleKey] || sub.titleKey;
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          onClick={onCloseMobile}
                          className={cn(
                            "block px-2 py-1.5 rounded-md text-xs transition-colors",
                            isSubActive
                              ? "font-semibold text-primary bg-primary/10"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                          )}
                        >
                          {subTitle}
                        </Link>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User Info Bar at Bottom of Sidebar */}
      <div className="p-4 border-t border-border flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
          {user?.name ? user.name.slice(0, 2) : "U"}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-semibold truncate">{user?.name || "User"}</span>
          <span className="text-[11px] text-muted-foreground truncate">
            {user?.roles?.[0] || (user?.isOwner ? "Owner" : "Staff")}
          </span>
        </div>
      </div>
    </aside>
  );
}
