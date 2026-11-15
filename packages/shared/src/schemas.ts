import { z } from "zod";
import { BUSINESS_TYPES } from "./types.js";

export const TenantSignupSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message:
        "Slug must contain only lowercase alphanumeric characters and hyphens",
    }),
  businessType: z.enum(BUSINESS_TYPES),
  owner: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(10).max(20),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    pin: z
      .string()
      .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
      .optional(),
  }),
  branch: z.object({
    name: z.string().trim().min(2).max(100),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(20)
      .regex(
        /^[A-Z0-9_-]+$/,
        "Branch code must be alphanumeric with optional dashes or underscores",
      ),
    address: z.string().trim().max(255).optional(),
  }),
});

export type TenantSignupDto = z.infer<typeof TenantSignupSchema>;

export const LoginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(3).max(50),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;

export const CreateBranchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Branch code must be alphanumeric"),
  address: z.string().trim().max(255).optional(),
});

export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;

export const CreateUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(10).max(20).optional(),
  password: z.string().min(8),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
  roleIds: z
    .array(z.string().uuid())
    .min(1, "At least one role must be assigned"),
  branchIds: z.array(z.string().uuid()).optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(10).max(20).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  permissionKeys: z
    .array(z.string())
    .min(1, "At least one permission required"),
  maxDiscountPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
});

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  permissionKeys: z.array(z.string()).min(1).optional(),
  maxDiscountPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
});

export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

// --- M2 Catalog Schemas ---

export const CreateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  parentId: z.string().uuid().optional().nullable(),
});
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = CreateCategorySchema.partial();
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;

export const CreateBrandSchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export type CreateBrandDto = z.infer<typeof CreateBrandSchema>;

export const UpdateBrandSchema = CreateBrandSchema.partial();
export type UpdateBrandDto = z.infer<typeof UpdateBrandSchema>;

export const CreateCollectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export type CreateCollectionDto = z.infer<typeof CreateCollectionSchema>;

export const UpdateCollectionSchema = CreateCollectionSchema.partial();
export type UpdateCollectionDto = z.infer<typeof UpdateCollectionSchema>;

export const CreateTaxClassSchema = z.object({
  name: z.string().trim().min(2).max(100),
  rateBp: z.number().int().min(0).max(10000), // 0% to 100%
  isDefault: z.boolean().optional(),
});
export type CreateTaxClassDto = z.infer<typeof CreateTaxClassSchema>;

export const UpdateTaxClassSchema = CreateTaxClassSchema.partial();
export type UpdateTaxClassDto = z.infer<typeof UpdateTaxClassSchema>;

export const ProductOptionInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  values: z.array(z.string().trim().min(1).max(50)).min(1),
});
export type ProductOptionInputDto = z.infer<typeof ProductOptionInputSchema>;

export const CreateProductSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  brandId: z.string().uuid().optional().nullable(),
  collectionId: z.string().uuid().optional().nullable(),
  taxClassId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().min(2).max(50),
  priceMinor: z.coerce.number().int().min(0),
  costMinor: z.coerce.number().int().min(0).optional(),
  reorderLevel: z.coerce.number().min(0).optional(),
  trackingMode: z.enum(["none", "batch", "serial"]).default("none"),
  customFields: z.record(z.unknown()).optional(),
  options: z.array(ProductOptionInputSchema).max(3).optional(),
});
export type CreateProductDto = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  brandId: z.string().uuid().optional().nullable(),
  collectionId: z.string().uuid().optional().nullable(),
  taxClassId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
  customFields: z.record(z.unknown()).optional(),
  options: z.array(ProductOptionInputSchema).max(3).optional(),
});
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;

export const BulkPriceUpdateSchema = z.object({
  variants: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        priceMinor: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});
export type BulkPriceUpdateDto = z.infer<typeof BulkPriceUpdateSchema>;

export const CreateBarcodeSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .optional(),
});
export type CreateBarcodeDto = z.infer<typeof CreateBarcodeSchema>;

// --- M3 Inventory Ledger Schemas ---

export const STOCK_MOVEMENT_TYPES = [
  "opening",
  "purchase",
  "sale",
  "sale_void",
  "adjustment",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const OpeningStockItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitCostMinor: z.coerce.number().int().min(0).optional(),
});

export const BulkOpeningStockSchema = z.object({
  branchId: z.string().uuid(),
  items: z.array(OpeningStockItemSchema).min(1, "At least one item required"),
});
export type BulkOpeningStockDto = z.infer<typeof BulkOpeningStockSchema>;

export const StockAdjustmentSchema = z.object({
  branchId: z.string().uuid(),
  variantId: z.string().uuid(),
  qtyDelta: z.coerce.number().refine((val) => val !== 0, {
    message: "Adjustment quantity delta cannot be zero",
  }),
  reason: z.string().trim().min(3).max(255),
});
export type StockAdjustmentDto = z.infer<typeof StockAdjustmentSchema>;

// --- M4 Suppliers & Purchasing Schemas ---

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(150),
  contactName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial();
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;

export const PurchaseOrderItemInputSchema = z.object({
  variantId: z.string().uuid(),
  qtyOrdered: z.coerce.number().positive(),
  unitCostMinor: z.coerce.number().int().min(0),
});

export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  poNumber: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  expectedAt: z.coerce.date().optional(),
  items: z.array(PurchaseOrderItemInputSchema).min(1),
});
export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;

export const GoodsReceiptItemInputSchema = z.object({
  purchaseOrderItemId: z.string().uuid().optional(),
  variantId: z.string().uuid(),
  qtyReceived: z.coerce.number().positive(),
  unitCostMinor: z.coerce.number().int().min(0),
});

export const CreateGoodsReceiptSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  grnNumber: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(GoodsReceiptItemInputSchema).min(1),
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

// --- M5 Customers, Registers & Shifts Schemas ---

export const CreateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateCustomerDto = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerSchema>;

export const CreateRegisterSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(50),
});
export type CreateRegisterDto = z.infer<typeof CreateRegisterSchema>;

export const UpdateRegisterSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRegisterDto = z.infer<typeof UpdateRegisterSchema>;

export const OpenShiftSchema = z.object({
  registerId: z.string().uuid(),
  branchId: z.string().uuid(),
  openingCashMinor: z.coerce.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
});
export type OpenShiftDto = z.infer<typeof OpenShiftSchema>;

export const CloseShiftSchema = z.object({
  closingCashMinor: z.coerce.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
});
export type CloseShiftDto = z.infer<typeof CloseShiftSchema>;

export const CashMovementSchema = z.object({
  type: z.enum(["cash_in", "cash_out"]),
  amountMinor: z.coerce.number().int().positive(),
  reason: z.string().trim().min(2).max(255),
});
export type CashMovementDto = z.infer<typeof CashMovementSchema>;

// --- M6 Sales Engine Schemas ---
export * from "./schemas/sales.schemas.js";
