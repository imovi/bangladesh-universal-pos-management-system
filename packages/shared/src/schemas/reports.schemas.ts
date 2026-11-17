import { z } from "zod";

export const ReturnsReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  reason: z.string().optional(),
  condition: z.enum(["resellable", "damaged"]).optional(),
  productId: z.string().uuid().optional(),
});

export type ReturnsReportQueryDto = z.infer<typeof ReturnsReportQuerySchema>;

export const DamagedStockReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type DamagedStockReportQueryDto = z.infer<typeof DamagedStockReportQuerySchema>;
