export interface PosStockLevel {
  id: string;
  tenantId?: string;
  branchId: string;
  variantId: string;
  qty: string | number;
  updatedAt?: string;
}

export interface PosOption {
  id: string;
  tenantId?: string;
  productId?: string;
  name: string;
  position: number;
}

export interface PosOptionValue {
  id: string;
  tenantId?: string;
  optionId?: string;
  value: string;
  position: number;
  option?: PosOption;
}

export interface PosVariantOptionValue {
  id?: string;
  tenantId?: string;
  variantId?: string;
  optionId?: string;
  optionValueId?: string;
  optionValue: PosOptionValue;
}

export interface PosProductVariant {
  id: string;
  tenantId?: string;
  productId: string;
  sku: string;
  priceMinor: number;
  costMinor?: number;
  reorderLevel?: string | number;
  isActive: boolean;
  barcodes?: Array<{ id?: string; barcode: string; isPrimary?: boolean }>;
  stockLevels?: PosStockLevel[];
  optionValues?: PosVariantOptionValue[];
  totalStock?: number;
  taxRateBp?: number;
}

export interface PosProduct {
  id: string;
  tenantId?: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  collectionId?: string | null;
  taxClassId?: string | null;
  isActive: boolean;
  trackingMode?: string;
  customFields?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  category?: { id: string; name: string } | null;
  brand?: { id: string; name: string } | null;
  collection?: { id: string; name: string } | null;
  taxClass?: { id: string; name: string; rateBp: number } | null;
  variants: PosProductVariant[];
  totalStock?: number;
  allowDecimals?: boolean;
}

export interface PosProductListResponse {
  success: boolean;
  data: PosProduct[];
  error?: unknown;
  meta?: {
    timestamp: string;
    requestId?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
