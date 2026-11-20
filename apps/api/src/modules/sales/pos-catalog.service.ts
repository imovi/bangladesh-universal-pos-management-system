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
      const promoWhere: Prisma.PromotionWhereInput = { tenantId, status: "active" };

      if (isValidDate) {
        productWhere.OR = [
          { updatedAt: { gte: sinceDate } },
          { variants: { some: { stockLevels: { some: { branchId, updatedAt: { gte: sinceDate } } } } } },
        ];
        variantWhere.OR = [
          { updatedAt: { gte: sinceDate } },
          { stockLevels: { some: { branchId, updatedAt: { gte: sinceDate } } } },
        ];
        categoryWhere.updatedAt = { gte: sinceDate };
        taxWhere.updatedAt = { gte: sinceDate };
        promoWhere.updatedAt = { gte: sinceDate };
      }

      const [products, variants, categories, taxClasses, promotions] = await Promise.all([
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
        tx.promotion.findMany({
          where: promoWhere,
          orderBy: { priority: "desc" },
        }),
      ]);

      let maxUpdated = 0;
      for (const p of products) {
        maxUpdated = Math.max(maxUpdated, p.updatedAt.getTime());
      }
      for (const v of variants) {
        maxUpdated = Math.max(maxUpdated, v.updatedAt.getTime());
      }
      for (const pr of promotions) {
        maxUpdated = Math.max(maxUpdated, pr.updatedAt.getTime());
      }

      const catalogVersion = maxUpdated > 0 ? `v-${maxUpdated}` : `v-${Date.now()}`;
      const now = new Date();

      // Highest offline sequence today for sales in this branch (in Bangladesh business timezone)
      const todayYymmdd = formatDateKey(now, "Asia/Dhaka");
      const latestOfflineSale = await tx.sale.findFirst({
        where: {
          tenantId,
          branchId,
          OR: [
            { isOffline: true, invoiceNumber: { contains: `-O-${todayYymmdd}-` } },
            { offlineInvoiceNumber: { contains: `-O-${todayYymmdd}-` } },
          ],
        },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true, offlineInvoiceNumber: true },
      });
      let lastOfflineSeq = 0;
      const invToParse = latestOfflineSale?.offlineInvoiceNumber || latestOfflineSale?.invoiceNumber;
      if (invToParse) {
        const match = invToParse.match(/-O-\d{6}-(\d{4})$/);
        if (match) lastOfflineSeq = parseInt(match[1], 10);
      }

      return {
        catalogVersion,
        serverTime: now.toISOString(),
        cursor: now.toISOString(),
        lastOfflineSeq,
        categories,
        taxClasses,
        promotions: promotions.map((pr) => ({
          id: pr.id,
          name: pr.name,
          description: pr.description,
          type: pr.type,
          status: pr.status,
          priority: pr.priority,
          stackableWithBill: pr.stackableWithBill,
          startDate: pr.startDate ? pr.startDate.toISOString() : null,
          endDate: pr.endDate ? pr.endDate.toISOString() : null,
          config: pr.config,
          targets: pr.targets,
          conditions: pr.conditions,
          updatedAt: pr.updatedAt.toISOString(),
        })),
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
