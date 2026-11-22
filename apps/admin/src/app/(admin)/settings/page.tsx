"use client";

import React from "react";
import Link from "next/link";
import { PermissionGate } from "@/components/common/permission-gate";
import { useTranslation } from "@/i18n/context";
import { BackupsCard } from "@/components/settings/backups-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Store, GitBranch, Users, Shield, Award, ArrowRight, Printer, UploadCloud } from "lucide-react";

export default function SettingsIndexPage() {
  const { strings } = useTranslation();

  const settingsLinks = [
    {
      title: strings.nav.shopSettings,
      desc: strings.settings.title,
      href: "/settings/shop",
      icon: Store,
      permission: "tenant.read",
    },
    {
      title: strings.nav.loyaltySettings,
      desc: strings.loyalty.subtitle,
      href: "/settings/loyalty",
      icon: Award,
      permission: "tenant.read",
    },
    {
      title: strings.nav.branches,
      desc: strings.settings.branchesDesc,
      href: "/settings/branches",
      icon: GitBranch,
      permission: "branch.read",
    },
    {
      title: strings.nav.usersAndRoles,
      desc: strings.settings.usersDesc,
      href: "/settings/users",
      icon: Users,
      permission: "user.read",
    },
    {
      title: strings.nav.roles,
      desc: strings.settings.rolesDesc,
      href: "/settings/roles",
      icon: Shield,
      permission: "role.read",
    },
    {
      title: strings.nav.printerSettings,
      desc: strings.settings.printerDesc,
      href: "/settings/printer",
      icon: Printer,
      permission: "tenant.read",
    },
    {
      title: strings.nav.dataImport,
      desc: strings.importData.subtitle,
      href: "/settings/import",
      icon: UploadCloud,
      permission: "data.import",
    },
  ];

  return (
    <PermissionGate permission="tenant.read">
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{strings.nav.settings}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {strings.settings.backupsDesc}
          </p>
        </div>

        {/* Backups Card (Owner only) */}
        <BackupsCard />

        {/* Navigation Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {settingsLinks.map((item) => {
            const Icon = item.icon;
            return (
              <PermissionGate key={item.href} permission={item.permission}>
                <Link href={item.href}>
                  <Card className="hover:border-primary/50 transition-colors h-full cursor-pointer group">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <Icon className="h-5 w-5" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <CardTitle className="text-base font-semibold pt-2">{item.title}</CardTitle>
                      <CardDescription className="text-xs line-clamp-2">{item.desc}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </PermissionGate>
            );
          })}
        </div>
      </div>
    </PermissionGate>
  );
}
