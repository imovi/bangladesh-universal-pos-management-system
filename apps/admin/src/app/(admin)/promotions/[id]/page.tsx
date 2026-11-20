"use client";

import React from "react";
import { useParams } from "next/navigation";
import { PermissionGate } from "@/components/common/permission-gate";
import { PromotionForm } from "@/components/promotions/promotion-form";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { useQuery } from "@tanstack/react-query";

export default function EditPromotionPage() {
  const params = useParams();
  const id = params?.id as string;
  const { apiFetch } = useAuth();
  const { strings } = useTranslation();

  const { data: promo, isLoading, error } = useQuery({
    queryKey: ["promotion-detail", id],
    queryFn: async () => {
      const res = await apiFetch(`/promotions/${id}`);
      if (!res.ok) throw new Error("Failed to load promotion");
      return res.json();
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        {strings.common.loading}
      </div>
    );
  }

  if (error || !promo) {
    return (
      <div className="p-4 text-destructive">
        {strings.promotions.noPromotionsFound}
      </div>
    );
  }

  return (
    <PermissionGate permission="promotion.view">
      <PromotionForm initialData={promo?.data || promo} isEdit />
    </PermissionGate>
  );
}
