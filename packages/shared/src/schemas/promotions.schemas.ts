import { z } from "zod";

export const PromotionTypeSchema = z.enum([
  "PERCENT_OFF",
  "AMOUNT_OFF",
  "FIXED_PRICE",
  "BUY_X_GET_Y",
  "BUNDLE_PRICE",
  "BILL_THRESHOLD",
]);

export const PromotionStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "ended",
]);

export const CreatePromotionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  type: PromotionTypeSchema,
  status: PromotionStatusSchema.default("active"),
  priority: z.number().int().default(0),
  stackableWithBill: z.boolean().default(true),
  startDate: z.string().or(z.date()).optional().nullable(),
  endDate: z.string().or(z.date()).optional().nullable(),
  config: z.record(z.any()).default({}),
  targets: z.record(z.any()).default({}),
  conditions: z.record(z.any()).default({}),
});

export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>;

export const UpdatePromotionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: PromotionStatusSchema.optional(),
  priority: z.number().int().optional(),
  stackableWithBill: z.boolean().optional(),
  startDate: z.string().or(z.date()).optional().nullable(),
  endDate: z.string().or(z.date()).optional().nullable(),
  config: z.record(z.any()).optional(),
  targets: z.record(z.any()).optional(),
  conditions: z.record(z.any()).optional(),
});

export type UpdatePromotionInput = z.infer<typeof UpdatePromotionSchema>;

export const PromotionQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PromotionQueryInput = z.infer<typeof PromotionQuerySchema>;

export const PreviewPromotionLineSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  unitPriceMinor: z.union([z.bigint(), z.number(), z.string()]),
  quantity: z.union([z.number(), z.string()]),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  collectionId: z.string().optional(),
});

export const PreviewPromotionSchema = z.object({
  promotion: z.object({
    id: z.string().optional(),
    name: z.string(),
    type: PromotionTypeSchema,
    status: PromotionStatusSchema.default("active"),
    priority: z.number().int().default(0),
    stackableWithBill: z.boolean().default(true),
    config: z.record(z.any()).default({}),
    targets: z.record(z.any()).default({}),
    conditions: z.record(z.any()).default({}),
    startDate: z.string().or(z.date()).optional().nullable(),
    endDate: z.string().or(z.date()).optional().nullable(),
  }),
  lines: z.array(PreviewPromotionLineSchema).min(1).max(5),
  couponCode: z.string().optional(),
  branchId: z.string().optional(),
  customerId: z.string().optional(),
  evaluationTime: z.string().or(z.date()).optional(),
});

export type PreviewPromotionInput = z.infer<typeof PreviewPromotionSchema>;
