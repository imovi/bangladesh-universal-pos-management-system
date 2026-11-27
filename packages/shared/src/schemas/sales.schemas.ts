import { z } from "zod";

export const LineDiscountInputSchema = z.object({
  type: z.enum(["fixed", "percent"]),
  amountMinor: z.coerce.number().int().min(0).optional(),
  percentBp: z.coerce.number().int().min(0).max(10000).optional(),
});

export const SaleItemInputSchema = z.object({
  lineId: z.string().optional(),
  variantId: z.string().uuid(),
  productUnitId: z.string().uuid().optional().nullable(),
  unitName: z.string().trim().optional().nullable(),
  unitFactor: z.coerce.number().positive().optional().nullable(),
  quantity: z.coerce.number().positive(),
  overrideUnitPriceMinor: z.coerce.number().int().min(0).optional(),
  unitPriceMinor: z.coerce.number().int().min(0).optional(),
  discount: LineDiscountInputSchema.optional(),
  promotionId: z.string().uuid().optional().nullable(),
  promotionDiscountMinor: z.coerce.number().int().min(0).optional(),
  promotionLabel: z.string().optional().nullable(),
});

export const SALE_PAYMENT_METHODS = [
  "cash",
  "card",
  "bkash",
  "nagad",
  "rocket",
  "bank_transfer",
  "points",
] as const;

export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

export const SalePaymentInputSchema = z.object({
  paymentMethod: z.enum(SALE_PAYMENT_METHODS),
  amountMinor: z.coerce.number().int().positive(),
  reference: z.string().trim().max(100).optional(),
});

export const CreateSaleSchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  branchId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  billDiscount: LineDiscountInputSchema.optional(),
  billPromotionId: z.string().uuid().optional().nullable(),
  billPromotionDiscountMinor: z.coerce.number().int().min(0).optional().nullable(),
  couponCode: z.string().trim().max(100).optional().nullable(),
  pointsRedeemed: z.coerce.number().int().min(0).optional(),
  items: z.array(SaleItemInputSchema).min(1, "Sale must have at least one line item"),
  payments: z.array(SalePaymentInputSchema).default([]),
  notes: z.string().trim().max(500).optional().nullable(),
  expectedTotalMinor: z.coerce.number().int().min(0),
  isOffline: z.boolean().optional().default(false),
  occurredAt: z.string().optional(),
  catalogVersion: z.string().trim().max(100).optional().nullable(),
  invoiceNumber: z.string().trim().max(100).optional().nullable(),
});
export type CreateSaleDto = z.infer<typeof CreateSaleSchema>;

export const VoidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(255),
});
export type VoidSaleDto = z.infer<typeof VoidSaleSchema>;

export const ResolveSaleReviewFlagSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});
export type ResolveSaleReviewFlagDto = z.infer<typeof ResolveSaleReviewFlagSchema>;
