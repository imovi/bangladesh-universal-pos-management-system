import { z } from "zod";

export const StockTransferStatusEnum = z.enum(["draft", "sent", "received", "cancelled"]);
export type StockTransferStatus = z.infer<typeof StockTransferStatusEnum>;

export const CreateStockTransferItemSchema = z.object({
  variantId: z.string().uuid("Invalid variant ID"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
});
export type CreateStockTransferItemDto = z.infer<typeof CreateStockTransferItemSchema>;

export const CreateStockTransferSchema = z
  .object({
    id: z.string().uuid().optional(),
    sourceBranchId: z.string().uuid("Invalid source branch ID"),
    destinationBranchId: z.string().uuid("Invalid destination branch ID"),
    notes: z.string().trim().max(1000).optional(),
    items: z
      .array(CreateStockTransferItemSchema)
      .min(1, "At least one item is required in the transfer"),
  })
  .refine((data) => data.sourceBranchId !== data.destinationBranchId, {
    message: "Source and destination branch cannot be the same",
    path: ["destinationBranchId"],
  });
export type CreateStockTransferDto = z.infer<typeof CreateStockTransferSchema>;

export const SendStockTransferSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});
export type SendStockTransferDto = z.infer<typeof SendStockTransferSchema>;

export const ReceiveStockTransferItemSchema = z.object({
  variantId: z.string().uuid("Invalid variant ID"),
  receivedQty: z.coerce.number().min(0, "Received quantity cannot be negative"),
  lossReason: z.string().trim().max(500).optional(),
});
export type ReceiveStockTransferItemDto = z.infer<typeof ReceiveStockTransferItemSchema>;

export const ReceiveStockTransferSchema = z.object({
  items: z
    .array(ReceiveStockTransferItemSchema)
    .min(1, "At least one received item specification is required"),
  lossReason: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type ReceiveStockTransferDto = z.infer<typeof ReceiveStockTransferSchema>;

export const StockTransferQuerySchema = z.object({
  status: StockTransferStatusEnum.optional(),
  branchId: z.string().uuid().optional(),
  sourceBranchId: z.string().uuid().optional(),
  destinationBranchId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "transferNumber", "status"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type StockTransferQueryDto = z.infer<typeof StockTransferQuerySchema>;
