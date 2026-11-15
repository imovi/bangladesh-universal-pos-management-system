import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

export interface ReportDateFilter {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  private buildDateFilter(filter: ReportDateFilter): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = { status: "completed" };
    if (filter.branchId) where.branchId = filter.branchId;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = new Date(filter.startDate);
      if (filter.endDate) where.createdAt.lte = new Date(filter.endDate);
    }
    return where;
  }

  async getSalesSummary(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sales = await tx.sale.findMany({
        where: { tenantId, ...this.buildDateFilter(filter) },
        include: { payments: true },
      });

      let totalGrossMinor = 0n;
      let totalDiscountMinor = 0n;
      let totalTaxMinor = 0n;
      let totalNetMinor = 0n;
      const paymentsByMethod: Record<string, number> = {};

      for (const s of sales) {
        totalGrossMinor += s.subtotalMinor;
        totalDiscountMinor += s.discountMinor;
        totalTaxMinor += s.taxMinor;
        totalNetMinor += s.totalMinor;
        for (const p of s.payments) {
          paymentsByMethod[p.paymentMethod] = (paymentsByMethod[p.paymentMethod] || 0) + Number(p.amountMinor);
        }
      }

      return {
        salesCount: sales.length,
        totalGrossMinor: Number(totalGrossMinor),
        totalDiscountMinor: Number(totalDiscountMinor),
        totalTaxMinor: Number(totalTaxMinor),
        totalNetMinor: Number(totalNetMinor),
        paymentsByMethod,
      };
    });
  }

  async getSalesByVariant(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter) } },
        include: { variant: { include: { product: true } } },
      });

      const map = new Map<string, { variantId: string; sku: string; productName: string; qty: number; rev: bigint }>();
      for (const it of items) {
        const vId = it.variantId;
        const entry = map.get(vId) || {
          variantId: vId, sku: it.variant.sku, productName: it.variant.product.name, qty: 0, rev: 0n,
        };
        entry.qty += Number(it.quantity);
        entry.rev += it.totalMinor;
        map.set(vId, entry);
      }

      return Array.from(map.values()).map((e) => ({
        variantId: e.variantId, sku: e.sku, productName: e.productName, quantitySold: e.qty,
        revenueMinor: Number(e.rev), averagePriceMinor: e.qty > 0 ? Number(e.rev / BigInt(e.qty)) : 0,
      }));
    });
  }

  async getSalesByCategory(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter) } },
        include: { variant: { include: { product: { include: { category: true } } } } },
      });

      const map = new Map<string, { categoryId: string; categoryName: string; totalRevenueMinor: number; itemsCount: number }>();
      for (const it of items) {
        const cat = it.variant.product.category;
        const catId = cat?.id || "uncategorized";
        const catName = cat?.name || "Uncategorized";
        const entry = map.get(catId) || { categoryId: catId, categoryName: catName, totalRevenueMinor: 0, itemsCount: 0 };
        entry.totalRevenueMinor += Number(it.totalMinor);
        entry.itemsCount += Number(it.quantity);
        map.set(catId, entry);
      }
      return Array.from(map.values());
    });
  }

  async getSalesByBrand(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter) } },
        include: { variant: { include: { product: { include: { brand: true } } } } },
      });

      const map = new Map<string, { brandId: string; brandName: string; totalRevenueMinor: number; itemsCount: number }>();
      for (const it of items) {
        const br = it.variant.product.brand;
        const bId = br?.id || "unbranded";
        const bName = br?.name || "Unbranded";
        const entry = map.get(bId) || { brandId: bId, brandName: bName, totalRevenueMinor: 0, itemsCount: 0 };
        entry.totalRevenueMinor += Number(it.totalMinor);
        entry.itemsCount += Number(it.quantity);
        map.set(bId, entry);
      }
      return Array.from(map.values());
    });
  }

  async getSalesByCollection(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter) } },
        include: { variant: { include: { product: { include: { collection: true } } } } },
      });

      const map = new Map<string, { collectionId: string; collectionName: string; totalRevenueMinor: number; itemsCount: number }>();
      for (const it of items) {
        const col = it.variant.product.collection;
        const cId = col?.id || "uncollected";
        const cName = col?.name || "Uncollected";
        const entry = map.get(cId) || { collectionId: cId, collectionName: cName, totalRevenueMinor: 0, itemsCount: 0 };
        entry.totalRevenueMinor += Number(it.totalMinor);
        entry.itemsCount += Number(it.quantity);
        map.set(cId, entry);
      }
      return Array.from(map.values());
    });
  }

  async getVariantMatrix(tenantId: string, query: { productId: string; branchId?: string }) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: query.productId },
        include: {
          options: true,
          variants: {
            include: {
              optionValues: { include: { optionValue: { include: { option: true } } } },
              stockLevels: query.branchId ? { where: { branchId: query.branchId } } : true,
              saleItems: { where: { sale: { status: "completed" } } },
            },
          },
        },
      });
      if (!product || product.tenantId !== tenantId) throw new NotFoundException("Product not found");

      const cells = product.variants.map((v) => {
        const stockQty = v.stockLevels.reduce((s, sl) => s + Number(sl.qty), 0);
        const qtySold = v.saleItems.reduce((s, si) => s + Number(si.quantity), 0);
        const optMap: Record<string, string> = {};
        for (const ov of v.optionValues) {
          if (ov.optionValue?.option) {
            optMap[ov.optionValue.option.name] = ov.optionValue.value;
          }
        }
        return { variantId: v.id, sku: v.sku, options: optMap, stockQty, qtySold };
      });

      return { productId: product.id, productName: product.name, options: product.options.map((o) => o.name), cells };
    });
  }

  async getProfitReport(tenantId: string, filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter) } },
      });

      let revenueMinor = 0n;
      let cogsMinor = 0n;
      for (const it of items) {
        revenueMinor += it.totalMinor;
        cogsMinor += (it.unitCostMinor * BigInt(Math.round(Number(it.quantity))));
      }

      const grossProfitMinor = revenueMinor - cogsMinor;
      const profitMarginBp = revenueMinor > 0n ? Number((grossProfitMinor * 10000n) / revenueMinor) : 0;

      return {
        revenueMinor: Number(revenueMinor),
        cogsMinor: Number(cogsMinor),
        grossProfitMinor: Number(grossProfitMinor),
        profitMarginBp,
      };
    });
  }

  async getStockValuation(tenantId: string, filter: { branchId?: string }) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const stockLevels = await tx.stockLevel.findMany({
        where: { tenantId, ...(filter.branchId ? { branchId: filter.branchId } : {}) },
        include: { variant: { include: { product: true } } },
      });

      let totalValuationMinor = 0n;
      let totalQty = 0;
      const items = stockLevels.map((sl) => {
        const qty = Number(sl.qty);
        const cost = sl.variant.costMinor;
        const val = BigInt(Math.round(qty)) * cost;
        totalValuationMinor += val;
        totalQty += qty;
        return {
          variantId: sl.variantId, sku: sl.variant.sku, productName: sl.variant.product.name,
          quantity: qty, unitCostMinor: Number(cost), valuationMinor: Number(val),
        };
      });

      return { totalQty, totalValuationMinor: Number(totalValuationMinor), items };
    });
  }

  async getShiftReport(tenantId: string, shiftId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const shift = await tx.shift.findUnique({
        where: { id: shiftId },
        include: {
          register: true,
          cashierUser: { select: { id: true, name: true } },
          cashMovements: true,
          sales: { where: { status: "completed" }, include: { payments: true } },
        },
      });
      if (!shift || shift.tenantId !== tenantId) throw new NotFoundException("Shift not found");

      let cashSalesMinor = 0n;
      let bkashSalesMinor = 0n;
      let cardSalesMinor = 0n;
      for (const s of shift.sales) {
        for (const p of s.payments) {
          if (p.paymentMethod === "cash") cashSalesMinor += p.amountMinor;
          else if (p.paymentMethod === "card") cardSalesMinor += p.amountMinor;
          else if (["bkash", "nagad", "rocket"].includes(p.paymentMethod)) bkashSalesMinor += p.amountMinor;
        }
      }

      const cashInMinor = shift.cashMovements.filter((m) => m.type === "cash_in").reduce((s, m) => s + m.amountMinor, 0n);
      const cashOutMinor = shift.cashMovements.filter((m) => m.type === "cash_out").reduce((s, m) => s + m.amountMinor, 0n);
      const expectedCashMinor = shift.openingCashMinor + cashSalesMinor + cashInMinor - cashOutMinor;

      const transactions = [
        ...shift.sales.map((s) => ({ type: "sale", id: s.id, inv: s.invoiceNumber, totalMinor: Number(s.totalMinor), at: s.createdAt })),
        ...shift.cashMovements.map((m) => ({ type: m.type, id: m.id, amountMinor: Number(m.amountMinor), reason: m.reason, at: m.createdAt })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      return {
        shiftId: shift.id, registerName: shift.register.name, cashierName: shift.cashierUser.name, status: shift.status,
        openingCashMinor: Number(shift.openingCashMinor), cashInMinor: Number(cashInMinor), cashOutMinor: Number(cashOutMinor),
        cashSalesMinor: Number(cashSalesMinor), expectedCashMinor: Number(expectedCashMinor),
        closingCashMinor: shift.closingCashMinor ? Number(shift.closingCashMinor) : null,
        differenceMinor: shift.cashDifferenceMinor ? Number(shift.cashDifferenceMinor) : null,
        bkashSalesMinor: Number(bkashSalesMinor), cardSalesMinor: Number(cardSalesMinor),
        totalSalesCount: shift.sales.length, transactions,
      };
    });
  }
}
