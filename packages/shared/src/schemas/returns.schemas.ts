import { z } from "zod";
import { SaleItemInputSchema, SalePaymentInputSchema, LineDiscountInputSchema } from "./sales.schemas.js";

export const RETURN_CONDITIONS = ["resellable", "damaged"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const REFUND_METHODS = [
  "cash",
  "bkash",
  "nagad",
  "rocket",
  "card",
  "bank_transfer",
  "credit_deduction",
] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const CreateSaleReturnItemSchema = z.object({
  saleItemId: z.string().uuid("Invalid saleItemId: must be a valid UUID"),
  quantity: z
    .union([z.string(), z.number()])
    .refine((val) => {
      const n = typeof val === "number" ? val : parseFloat(val);
      return !isNaN(n) && n > 0;
    }, "Quantity must be a positive number"),
  condition: z.enum(RETURN_CONDITIONS).default("resellable"),
});
export type CreateSaleReturnItemDto = z.infer<typeof CreateSaleReturnItemSchema>;

export const CreateSaleReturnSchema = z.object({
  id: z.string().uuid("Invalid return ID: must be a valid UUID v7"),
  shiftId: z.string().uuid("Invalid shift ID: must be a valid UUID"),
  refundMethod: z.enum(REFUND_METHODS),
  items: z.array(CreateSaleReturnItemSchema).min(1, "At least one item must be returned"),
  reason: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(500).optional(),
});
export type CreateSaleReturnDto = z.infer<typeof CreateSaleReturnSchema>;

export const CreateSaleExchangeSchema = z.object({
  id: z.string().uuid("Invalid exchange ID: must be a valid UUID v7"),
  shiftId: z.string().uuid("Invalid shift ID: must be a valid UUID"),
  branchId: z.string().uuid("Invalid branch ID: must be a valid UUID"),
  customerId: z.string().uuid().optional(),
  originalSaleId: z.string().uuid("Invalid originalSaleId: must be a valid UUID"),
  returnItems: z.array(CreateSaleReturnItemSchema).min(1, "At least one item must be returned"),
  newItems: z.array(SaleItemInputSchema).min(1, "At least one new item must be added for exchange"),
  payments: z.array(SalePaymentInputSchema).default([]),
  refundMethod: z.enum(REFUND_METHODS).optional(),
  notes: z.string().trim().max(500).optional(),
  billDiscount: LineDiscountInputSchema.optional(),
  returnReason: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(500).optional(),
});
export type CreateSaleExchangeDto = z.infer<typeof CreateSaleExchangeSchema>;

export const ListReturnsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  branchId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sortBy: z.enum(["createdAt", "returnNumber", "totalRefundMinor"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type ListReturnsQueryDto = z.infer<typeof ListReturnsQuerySchema>;
