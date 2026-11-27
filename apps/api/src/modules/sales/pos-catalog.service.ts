import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { formatDateKey, getActiveModules } from "@universal-pos/shared";
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

      const [products, variants, categories, taxClasses, promotions, coupons, flags] = await Promise.all([
        tx.product.findMany({
          where: productWhere,
          select: {
            id: true,
            name: true,
            categoryId: true,
            taxClassId: true,
            baseUnit: true,
            allowDecimalQty: true,
            units: {
              where: { isActive: true, isSaleUnit: true },
              select: {
                id: true,
                name: true,
                factor: true,
                sortOrder: true,
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
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
            unitPrices: true,
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
          include: { coupons: true },
          orderBy: { priority: "desc" },
        }),
        tx.coupon.findMany({
          where: { tenantId, isActive: true },
          select: {
            code: true,
            usageLimitTotal: true,
            usageLimitPerCustomer: true,
            promotionId: true,
            updatedAt: true,
          },
        }),
        tx.featureFlag.findMany({
          where: { key: { startsWith: "module." } },
          select: { key: true, allowed: true, enabled: true },
        }),
      ]);

      const activeModules = getActiveModules(flags);
      const isUnitsActive = activeModules.includes("units");

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
      for (const c of coupons) {
        maxUpdated = Math.max(maxUpdated, c.updatedAt.getTime());
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
        promotions: promotions.map((pr) => {
          const promoCoupons = pr.coupons || [];
          const unlimitedCodes = promoCoupons
            .filter((c: any) => c.isActive && c.usageLimitTotal === null && c.usageLimitPerCustomer === null)
            .map((c: any) => c.code.toUpperCase());
          const isCouponRequired = Boolean((pr.conditions as any)?.couponRequired || promoCoupons.length > 0);
          return {
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
            couponRequired: isCouponRequired,
            couponCodes: unlimitedCodes.length > 0 ? unlimitedCodes : undefined,
            updatedAt: pr.updatedAt.toISOString(),
          };
        }),
        limitedCouponCodes: coupons
          .filter((c) => c.usageLimitTotal !== null || c.usageLimitPerCustomer !== null)
          .map((c) => c.code.toUpperCase()),
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          categoryId: p.categoryId,
          taxClassId: p.taxClassId,
          baseUnit: isUnitsActive ? (p.baseUnit || "pcs") : "pcs",
          allowDecimalQty: isUnitsActive ? Boolean(p.allowDecimalQty) : false,
          units: isUnitsActive
            ? p.units.map((u) => ({
                id: u.id,
                name: u.name,
                factor: Number(u.factor),
                sortOrder: u.sortOrder,
              }))
            : [],
          isActive: p.isActive,
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
            barcodeUnits: isUnitsActive
              ? v.barcodes.map((b) => ({ barcode: b.barcode, productUnitId: b.productUnitId || null }))
              : [],
            unitPrices: isUnitsActive
              ? v.unitPrices.map((up) => ({ productUnitId: up.productUnitId, priceMinor: Number(up.priceMinor) }))
              : [],
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
