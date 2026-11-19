import type { PosProduct, PosProductVariant } from "./types";
import { sortSizes } from "@universal-pos/shared";

/**
 * Returns the numerical stock for a variant at a specific branch.
 * Handles string Decimals ('30', '30.000') and numbers safely without NaN.
 */
export function getVariantStock(variant: PosProductVariant, branchId?: string): number {
  if (!variant.stockLevels || !Array.isArray(variant.stockLevels)) {
    return 0;
  }
  const sl = branchId
    ? variant.stockLevels.find((s) => s.branchId === branchId)
    : variant.stockLevels[0];
  if (!sl) return 0;
  const num = Number(sl.qty);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

/**
 * Returns the total branch stock across all variants of a product.
 */
export function getProductBranchStock(product: PosProduct, branchId?: string): number {
  if (!product.variants || !Array.isArray(product.variants)) {
    return 0;
  }
  return product.variants.reduce((sum, v) => sum + getVariantStock(v, branchId), 0);
}

export interface MatrixItem {
  variant: PosProductVariant;
  stock: number;
  size: string;
  color: string;
}

export interface VariantMatrixResult {
  hasMatrix: boolean;
  sizes: string[];
  colors: string[];
  matrixMap: Map<string, MatrixItem>;
}

export function buildVariantMatrix(product: PosProduct, branchId?: string): VariantMatrixResult {
  if (!product.variants || product.variants.length === 0) {
    return { hasMatrix: false, sizes: [], colors: [], matrixMap: new Map() };
  }

  // Track options with their positions for correct sorting
  const sizeMap = new Map<string, number>(); // value -> position
  const colorMap = new Map<string, number>(); // value -> position
  const matrixMap = new Map<string, MatrixItem>();

  for (const v of product.variants) {
    let size: string | null = null;
    let sizePos = 999;
    let color: string | null = null;
    let colorPos = 999;

    if (v.optionValues && Array.isArray(v.optionValues)) {
      for (const ov of v.optionValues) {
        const optName = ov.optionValue?.option?.name?.toLowerCase().trim();
        const val = ov.optionValue?.value;
        const pos = ov.optionValue?.position ?? ov.optionValue?.option?.position ?? 0;

        if (optName === "size") {
          size = val;
          sizePos = pos;
        } else if (optName === "color" || optName === "colour") {
          color = val;
          colorPos = pos;
        }
      }
    }

    // If no size or color, fallback to variant SKU or product name, not 'Default' / 'Standard'
    if (!size && !color) {
      size = v.sku || "Standard";
      color = product.name;
    } else if (!size && color) {
      size = v.sku || "Standard";
    } else if (size && !color) {
      color = product.name;
    }

    if (size) {
      if (!sizeMap.has(size) || sizePos < (sizeMap.get(size) ?? 999)) {
        sizeMap.set(size, sizePos);
      }
    }
    if (color) {
      if (!colorMap.has(color) || colorPos < (colorMap.get(color) ?? 999)) {
        colorMap.set(color, colorPos);
      }
    }

    const stock = getVariantStock(v, branchId);
    matrixMap.set(`${color}:${size}`, {
      variant: v,
      stock,
      size: size || "",
      color: color || "",
    });
  }

  // Sort sizes by standard order: XS, S, M, L, XL, XXL, numbers ascending, then alphabetical
  const sizes = sortSizes(Array.from(sizeMap.keys()));

  // Sort colors by position, then insertion order
  const colors = Array.from(colorMap.entries())
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);

  return {
    hasMatrix: sizes.length > 0 && colors.length > 0,
    sizes,
    colors,
    matrixMap,
  };
}
