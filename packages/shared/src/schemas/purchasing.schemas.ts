import { z } from "zod";

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2).max(150),
  contactPerson: z.string().trim().max(100).optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().trim().max(255).optional(),
  taxNumber: z.string().trim().max(50).optional(),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
});
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;

export const PurchaseOrderItemSchema = z.object({
  variantId: z.string().uuid(),
  productUnitId: z.string().uuid().optional().nullable(),
  qtyOrdered: z.coerce.number().positive(),
  unitCostMinor: z.coerce.number().int().min(0),
});

export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  expectedDeliveryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(PurchaseOrderItemSchema).min(1, "PO must have at least one item"),
});
export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;

export const GoodsReceiptItemSchema = z.object({
  poItemId: z.string().uuid().optional(),
  variantId: z.string().uuid(),
  productUnitId: z.string().uuid().optional().nullable(),
  qtyReceived: z.coerce.number().positive(),
  unitCostMinor: z.coerce.number().int().min(0),
});

export const CreateGoodsReceiptSchema = z.object({
  poId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  supplierInvoiceNo: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  receivedAt: z.coerce.date().optional(),
  items: z.array(GoodsReceiptItemSchema).min(1, "GR must have at least one item"),
});
export type CreateGoodsReceiptDto = z.infer<typeof CreateGoodsReceiptSchema>;

export const CreateSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  amountMinor: z.coerce.number().int().positive(),
  paymentMethod: z.enum(["cash", "bank_transfer", "cheque", "mobile_banking"]),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  paidAt: z.coerce.date().optional(),
});
export type CreateSupplierPaymentDto = z.infer<typeof CreateSupplierPaymentSchema>;
