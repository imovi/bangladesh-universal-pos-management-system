"use client";

import React from "react";
import { PermissionGate } from "@/components/common/permission-gate";
import { PromotionForm } from "@/components/promotions/promotion-form";

export default function NewPromotionPage() {
  return (
    <PermissionGate permission="promotion.manage">
      <PromotionForm />
    </PermissionGate>
  );
}
