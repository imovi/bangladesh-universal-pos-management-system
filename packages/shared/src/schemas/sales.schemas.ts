import { z } from "zod";

export const LineDiscountInputSchema = z.object({
  type: z.enum(["fixed", "percent"]),
  amountMinor: z.coerce.number().int().min(0).optional(),
  percentBp: z.coerce.number().int().min(0).max(10000).optional(),
});

export const SaleItemInputSchema = z.object({
  lineId: z.string().optional(),
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  overrideUnitPriceMinor: z.coerce.number().int().min(0).optional(),
  discount: LineDiscountInputSchema.optional(),
});

export const SalePaymentInputSchema = z.object({
  paymentMethod: z.enum(["cash", "card", "bkash", "nagad", "rocket", "bank_transfer"]),
  amountMinor: z.coerce.number().int().positive(),
  reference: z.string().trim().max(100).optional(),
});

export const CreateSaleSchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  branchId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  billDiscount: LineDiscountInputSchema.optional(),
  items: z.array(SaleItemInputSchema).min(1, "Sale must have at least one line item"),
  payments: z.array(SalePaymentInputSchema).min(1, "At least one payment is required"),
  notes: z.string().trim().max(500).optional(),
  expectedTotalMinor: z.coerce.number().int().min(0),
});
export type CreateSaleDto = z.infer<typeof CreateSaleSchema>;

export const VoidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(255),
});
export type VoidSaleDto = z.infer<typeof VoidSaleSchema>;
