import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { formatDateKey } from "@universal-pos/shared";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

@Injectable()
export class PosCatalogService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async getCatalog(tenantId: string, branchId: string, since?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!branch) {
        throw new NotFoundException("Branch not found");
      }

      const sinceDate = since ? new Date(since) : undefined;
      const isValidDate = sinceDate && !isNaN(sinceDate.getTime());

      const productWhere: Prisma.ProductWhereInput = { tenantId };
      const variantWhere: Prisma.ProductVariantWhereInput = { tenantId };
      const categoryWhere: Prisma.CategoryWhereInput = { tenantId };
      const taxWhere: Prisma.TaxClassWhereInput = { tenantId };

      if (isValidDate) {
        productWhere.updatedAt = { gte: sinceDate };
        variantWhere.OR = [
          { updatedAt: { gte: sinceDate } },
          { stockLevels: { some: { branchId, updatedAt: { gte: sinceDate } } } },
        ];
        categoryWhere.updatedAt = { gte: sinceDate };
        taxWhere.updatedAt = { gte: sinceDate };
      }

      const [products, variants, categories, taxClasses] = await Promise.all([
        tx.product.findMany({
          where: productWhere,
          select: {
            id: true,
            name: true,
            categoryId: true,
            taxClassId: true,
            isActive: true,
            updatedAt: true,
          },
        }),
        tx.productVariant.findMany({
          where: variantWhere,
          include: {
            optionValues: {
              include: {
                optionValue: {
                  include: { option: true },
                },
              },
            },
            barcodes: true,
            stockLevels: {
              where: { branchId },
              select: { qty: true, updatedAt: true },
            },
          },
        }),
        tx.category.findMany({
          where: categoryWhere,
          select: {
            id: true,
            name: true,
            parentId: true,
            isActive: true,
          },
        }),
        tx.taxClass.findMany({
          where: taxWhere,
          select: {
            id: true,
            name: true,
            rateBp: true,
            isDefault: true,
          },
        }),
      ]);

      let maxUpdated = 0;
      for (const p of products) {
        maxUpdated = Math.max(maxUpdated, p.updatedAt.getTime());
      }
      for (const v of variants) {
        maxUpdated = Math.max(maxUpdated, v.updatedAt.getTime());
      }

      const catalogVersion = maxUpdated > 0 ? `v-${maxUpdated}` : `v-${Date.now()}`;
      const now = new Date();

      // Highest offline sequence today for sales in this branch (in Bangladesh business timezone)
      const todayYymmdd = formatDateKey(now, "Asia/Dhaka");
      const latestOfflineSale = await tx.sale.findFirst({
        where: {
          tenantId,
          branchId,
          isOffline: true,
          invoiceNumber: { contains: `-O-${todayYymmdd}-` },
        },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });
      let lastOfflineSeq = 0;
      if (latestOfflineSale?.invoiceNumber) {
        const match = latestOfflineSale.invoiceNumber.match(/-O-\d{6}-(\d{4})$/);
        if (match) lastOfflineSeq = parseInt(match[1], 10);
      }

      return {
        catalogVersion,
        serverTime: now.toISOString(),
        cursor: now.toISOString(),
        lastOfflineSeq,
        categories,
        taxClasses,
        products: products.map((p) => ({
          ...p,
          updatedAt: p.updatedAt.toISOString(),
        })),
        variants: variants.map((v) => {
          const stockQty = v.stockLevels.reduce((sum, sl) => sum + Number(sl.qty), 0);
          return {
            id: v.id,
            productId: v.productId,
            sku: v.sku,
            priceMinor: Number(v.priceMinor),
            costMinor: Number(v.costMinor),
            isActive: v.isActive,
            stockQty,
            barcodes: v.barcodes.map((b) => b.barcode),
            optionValues: v.optionValues.map((ov) => ({
              optionName: ov.optionValue.option.name,
              value: ov.optionValue.value,
            })),
            updatedAt: v.updatedAt.toISOString(),
          };
        }),
      };
    });
  }
}
