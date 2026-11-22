import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { calculateShiftCashTotals, parseDateFilterRange, formatBusinessDate } from "@universal-pos/shared";

export interface ReportDateFilter {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export interface CustomerBucket {
  customerId: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  totalDueMinor: number;
  bucket0to30Minor: number;
  bucket31to60Minor: number;
  bucket61to90Minor: number;
  bucketOver90Minor: number;
  oldestInvoiceDate: string;
  unpaidInvoicesCount: number;
}

export interface DueReportResponse {
  summary: {
    totalDueMinor: number;
    bucket0to30Minor: number;
    bucket31to60Minor: number;
    bucket61to90Minor: number;
    bucketOver90Minor: number;
    customerCount: number;
    invoiceCount: number;
  };
  customers: CustomerBucket[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly systemDb: SystemDbService,
  ) {}

  private async getTimeZone(tenantId: string): Promise<string> {
    const tenant = await this.systemDb.findTenantById(tenantId);
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    return (settings.timezone as string) || "Asia/Dhaka";
  }

  private buildDateFilter(filter: ReportDateFilter, timeZone = "Asia/Dhaka"): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = { status: "completed" };
    if (filter.branchId) where.branchId = filter.branchId;
    if (filter.startDate || filter.endDate) {
      const { gte, lte } = parseDateFilterRange(filter.startDate, filter.endDate, timeZone);
      where.occurredAt = {};
      if (gte) where.occurredAt.gte = gte;
      if (lte) where.occurredAt.lte = lte;
    }
    return where;
  }

  private buildReturnDateFilter(filter: ReportDateFilter, timeZone = "Asia/Dhaka"): Prisma.SaleReturnWhereInput {
    const where: Prisma.SaleReturnWhereInput = {};
    if (filter.branchId) where.shift = { register: { branchId: filter.branchId } };
    if (filter.startDate || filter.endDate) {
      const { gte, lte } = parseDateFilterRange(filter.startDate, filter.endDate, timeZone);
      where.createdAt = {};
      if (gte) where.createdAt.gte = gte;
      if (lte) where.createdAt.lte = lte;
    }
    return where;
  }

  async getSalesSummary(tenantId: string, filter: ReportDateFilter) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const dateRange = (filter.startDate || filter.endDate)
        ? parseDateFilterRange(filter.startDate, filter.endDate, tz)
        : null;

      const paymentWhere: Prisma.CustomerPaymentWhereInput = { tenantId };
      if (filter.branchId) paymentWhere.branchId = filter.branchId;
      if (dateRange) {
        paymentWhere.createdAt = {};
        if (dateRange.gte) paymentWhere.createdAt.gte = dateRange.gte;
        if (dateRange.lte) paymentWhere.createdAt.lte = dateRange.lte;
      }

      const [sales, returns, customerPayments] = await Promise.all([
        tx.sale.findMany({
          where: { tenantId, ...this.buildDateFilter(filter, tz) },
          include: { payments: true, items: { select: { promotionDiscountMinor: true } } },
        }),
        tx.saleReturn.findMany({
          where: { tenantId, ...this.buildReturnDateFilter(filter, tz) },
        }),
        tx.customerPayment.findMany({
          where: paymentWhere,
        }),
      ]);

      let totalGrossMinor = 0n;
      let totalDiscountMinor = 0n;
      let totalTaxMinor = 0n;
      let totalNetMinor = 0n;
      let totalCreditGivenMinor = 0n;
      let totalPromotionDiscountMinor = 0n;
      const paymentsByMethod: Record<string, number> = {};

      for (const s of sales) {
        totalGrossMinor += s.subtotalMinor;
        totalDiscountMinor += s.discountMinor;
        totalTaxMinor += s.taxMinor;
        totalNetMinor += s.totalMinor;
        if (s.dueMinor && s.dueMinor > 0n) {
          totalCreditGivenMinor += s.dueMinor;
        }
        for (const p of s.payments) {
          paymentsByMethod[p.paymentMethod] = (paymentsByMethod[p.paymentMethod] || 0) + Number(p.amountMinor);
        }
        totalPromotionDiscountMinor += s.billPromotionDiscountMinor || 0n;
        for (const it of s.items) {
          totalPromotionDiscountMinor += it.promotionDiscountMinor || 0n;
        }
      }

      let totalRefundMinor = 0n;
      for (const r of returns) {
        totalRefundMinor += r.totalRefundMinor;
        if (r.refundMethod in paymentsByMethod) {
          paymentsByMethod[r.refundMethod] -= Number(r.totalRefundMinor);
        }
      }

      let totalCreditCollectedMinor = 0n;
      for (const cp of customerPayments) {
        totalCreditCollectedMinor += cp.amountMinor;
      }

      return {
        salesCount: sales.length,
        returnsCount: returns.length,
        totalGrossMinor: Number(totalGrossMinor),
        totalDiscountMinor: Number(totalDiscountMinor),
        totalTaxMinor: Number(totalTaxMinor),
        totalNetMinor: Number(totalNetMinor - totalRefundMinor),
        totalRefundMinor: Number(totalRefundMinor),
        totalCreditGivenMinor: Number(totalCreditGivenMinor),
        totalCreditCollectedMinor: Number(totalCreditCollectedMinor),
        totalPromotionDiscountMinor: Number(totalPromotionDiscountMinor),
        totalPointsPaidMinor: Number(paymentsByMethod["points"] || 0),
        paymentsByMethod,
      };
    });
  }

  async getSalesByVariant(tenantId: string, filter: ReportDateFilter) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter, tz) } },
        include: {
          variant: {
            include: {
              product: true,
              optionValues: {
                include: {
                  optionValue: true,
                },
              },
            },
          },
        },
      });

      const map = new Map<string, { variantId: string; sku: string; productId: string; productName: string; variantName: string | null; qty: number; rev: bigint }>();
      for (const it of items) {
        const vId = it.variantId;
        const variantOptions = it.variant.optionValues?.length
          ? it.variant.optionValues.map((ov) => ov.optionValue.value).join(" / ")
          : null;
        const entry = map.get(vId) || {
          variantId: vId,
          sku: it.variant.sku,
          productId: it.variant.productId,
          productName: it.variant.product.name,
          variantName: variantOptions,
          qty: 0,
          rev: 0n,
        };
        entry.qty += Number(it.quantity);
        entry.rev += it.totalMinor;
        map.set(vId, entry);
      }

      return Array.from(map.values()).map((e) => ({
        variantId: e.variantId,
        sku: e.sku,
        productId: e.productId,
        productName: e.productName,
        variantName: e.variantName,
        quantitySold: e.qty,
        revenueMinor: Number(e.rev),
        averagePriceMinor: e.qty > 0 ? Number(e.rev / BigInt(e.qty)) : 0,
      }));
    });
  }

  async getSalesByCategory(tenantId: string, filter: ReportDateFilter) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter, tz) } },
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
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter, tz) } },
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
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const items = await tx.saleItem.findMany({
        where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter, tz) } },
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
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const [items, returnItems] = await Promise.all([
        tx.saleItem.findMany({
          where: { tenantId, sale: { tenantId, ...this.buildDateFilter(filter, tz) } },
        }),
        tx.saleReturnItem.findMany({
          where: { tenantId, saleReturn: { tenantId, ...this.buildReturnDateFilter(filter, tz) } },
          include: { saleItem: true },
        }),
      ]);

      let revenueMinor = 0n;
      let cogsMinor = 0n;
      for (const it of items) {
        revenueMinor += it.totalMinor;
        cogsMinor += it.unitCostMinor * BigInt(Math.round(Number(it.quantity)));
      }

      let returnedRevenueMinor = 0n;
      let returnedCogsMinor = 0n;
      for (const ri of returnItems) {
        returnedRevenueMinor += ri.totalRefundMinor;
        if (ri.condition === "resellable") {
          returnedCogsMinor += ri.saleItem.unitCostMinor * BigInt(Math.round(Number(ri.quantity)));
        }
      }

      const netRevenueMinor = revenueMinor - returnedRevenueMinor;
      const netCogsMinor = cogsMinor - returnedCogsMinor;
      const grossProfitMinor = netRevenueMinor - netCogsMinor;
      const profitMarginBp = netRevenueMinor > 0n ? Number((grossProfitMinor * 10000n) / netRevenueMinor) : 0;

      return {
        revenueMinor: Number(netRevenueMinor),
        cogsMinor: Number(netCogsMinor),
        grossProfitMinor: Number(grossProfitMinor),
        profitMarginBp,
        returnedRevenueMinor: Number(returnedRevenueMinor),
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
          returns: true,
          customerPayments: true,
          sales: { where: { status: "completed" }, include: { payments: true } },
        },
      });
      if (!shift || shift.tenantId !== tenantId) throw new NotFoundException("Shift not found");

      const calc = calculateShiftCashTotals({
        openingCashMinor: shift.openingCashMinor,
        cashMovements: shift.cashMovements,
        sales: shift.sales,
        returns: shift.returns,
        customerPayments: shift.customerPayments,
      });

      const transactions = [
        ...shift.sales.map((s) => ({ type: "sale", id: s.id, inv: s.invoiceNumber, totalMinor: Number(s.totalMinor), at: (s.occurredAt || s.createdAt).toISOString() })),
        ...shift.returns.map((r) => ({ type: "return", id: r.id, inv: r.returnNumber, totalMinor: -Number(r.totalRefundMinor), at: r.createdAt })),
        ...(shift.customerPayments || []).map((cp: any) => ({ type: "payment", id: cp.id, inv: cp.paymentNumber, totalMinor: Number(cp.amountMinor), at: cp.createdAt })),
        ...shift.cashMovements.map((m) => ({ type: m.type, id: m.id, amountMinor: Number(m.amountMinor), reason: m.reason, at: m.createdAt })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      const paymentMethodTotalsMinor = Object.fromEntries(
        Object.entries(calc.paymentMethodTotalsMinor).map(([k, v]) => [k, Number(v)]),
      );

      return {
        shiftId: shift.id,
        registerName: shift.register.name,
        cashierName: shift.cashierUser.name,
        status: shift.status,
        openingCashMinor: Number(calc.openingCashMinor),
        cashInMinor: Number(calc.cashInMinor),
        cashOutMinor: Number(calc.cashOutMinor),
        cashSalesMinor: Number(calc.cashPaymentsMinor),
        returnsMinor: Number(calc.totalRefundsMinor),
        returnsCount: calc.returnsCount,
        expectedCashMinor: Number(calc.expectedCashMinor),
        closingCashMinor: shift.closingCashMinor ? Number(shift.closingCashMinor) : null,
        differenceMinor: shift.cashDifferenceMinor ? Number(shift.cashDifferenceMinor) : null,
        paymentMethodTotalsMinor,
        bkashSalesMinor: Number(calc.bkashSalesMinor),
        cardSalesMinor: Number(calc.cardSalesMinor),
        totalSalesCount: calc.completedSalesCount,
        transactions,
      };
    });
  }

  async getDueReport(tenantId: string, filter?: { branchId?: string }): Promise<DueReportResponse> {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SaleWhereInput = {
        tenantId,
        status: "completed",
        dueMinor: { gt: 0n },
      };
      if (filter?.branchId) {
        where.branchId = filter.branchId;
      }

      const sales = await tx.sale.findMany({
        where,
        include: {
          customer: true,
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { occurredAt: "asc" },
      });

      const now = new Date();
      let totalDueMinor = 0n;
      let bucket0to30Minor = 0n;
      let bucket31to60Minor = 0n;
      let bucket61to90Minor = 0n;
      let bucketOver90Minor = 0n;

      const customerMap = new Map<string, CustomerBucket>();

      for (const s of sales) {
        const due = BigInt(s.dueMinor);
        totalDueMinor += due;

        const saleDate = s.occurredAt || s.createdAt;
        const ageDays = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
        let b0 = 0n;
        let b31 = 0n;
        let b61 = 0n;
        let bover = 0n;

        if (ageDays <= 30) {
          bucket0to30Minor += due;
          b0 = due;
        } else if (ageDays <= 60) {
          bucket31to60Minor += due;
          b31 = due;
        } else if (ageDays <= 90) {
          bucket61to90Minor += due;
          b61 = due;
        } else {
          bucketOver90Minor += due;
          bover = due;
        }

        const cId = s.customerId || "walk-in";
        const cName = s.customer?.name || "Walk-in Customer";
        const cPhone = s.customer?.phone || "-";
        const existing = customerMap.get(cId) || {
          customerId: cId,
          customerName: cName,
          customerPhone: cPhone,
          branchName: s.branch.name,
          totalDueMinor: 0,
          bucket0to30Minor: 0,
          bucket31to60Minor: 0,
          bucket61to90Minor: 0,
          bucketOver90Minor: 0,
          oldestInvoiceDate: saleDate.toISOString(),
          unpaidInvoicesCount: 0,
        };

        existing.totalDueMinor += Number(due);
        existing.bucket0to30Minor += Number(b0);
        existing.bucket31to60Minor += Number(b31);
        existing.bucket61to90Minor += Number(b61);
        existing.bucketOver90Minor += Number(bover);
        existing.unpaidInvoicesCount += 1;
        customerMap.set(cId, existing);
      }

      return {
        summary: {
          totalDueMinor: Number(totalDueMinor),
          bucket0to30Minor: Number(bucket0to30Minor),
          bucket31to60Minor: Number(bucket31to60Minor),
          bucket61to90Minor: Number(bucket61to90Minor),
          bucketOver90Minor: Number(bucketOver90Minor),
          customerCount: customerMap.size,
          invoiceCount: sales.length,
        },
        customers: Array.from(customerMap.values()),
      };
    });
  }

  async getReturnsReport(
    tenantId: string,
    filter: ReportDateFilter & { reason?: string; condition?: string; productId?: string },
  ) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const returnWhere: Prisma.SaleReturnWhereInput = {
        tenantId,
        ...this.buildReturnDateFilter(filter, tz),
      };

      const returns = await tx.saleReturn.findMany({
        where: returnWhere,
        include: {
          sale: { select: { id: true, invoiceNumber: true } },
          shift: {
            include: {
              register: {
                include: { branch: { select: { id: true, name: true, code: true } } },
              },
            },
          },
          items: {
            include: {
              saleItem: {
                include: {
                  variant: {
                    include: {
                      product: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      let totalRefundMinor = 0n;
      let totalReturnedUnits = 0;
      let resellableUnits = 0;
      let damagedUnits = 0;
      let resellableRefundMinor = 0n;
      let damagedRefundMinor = 0n;

      const dailyMap = new Map<string, { date: string; returnsCount: number; totalRefundMinor: number; units: number }>();
      const reasonMap = new Map<string, { reason: string; count: number; totalRefundMinor: number }>();
      const productReturnMap = new Map<string, { productId: string; productName: string; returnedUnits: number }>();
      const itemsList: any[] = [];

      for (const ret of returns) {
        const dateKey = formatBusinessDate(ret.createdAt, tz);
        let returnIncludedInFilter = false;

        for (const item of ret.items) {
          if (filter.condition && item.condition !== filter.condition) continue;
          if (filter.reason && ret.reason !== filter.reason) continue;
          if (filter.productId && item.saleItem.variant.product.id !== filter.productId) continue;

          returnIncludedInFilter = true;
          const qty = Math.round(Number(item.quantity));
          const refund = BigInt(item.totalRefundMinor);

          totalRefundMinor += refund;
          totalReturnedUnits += qty;

          if (item.condition === "resellable") {
            resellableUnits += qty;
            resellableRefundMinor += refund;
          } else {
            damagedUnits += qty;
            damagedRefundMinor += refund;
          }

          const rKey = ret.reason || "unspecified";
          const currReason = reasonMap.get(rKey) || { reason: rKey, count: 0, totalRefundMinor: 0 };
          currReason.count += qty;
          currReason.totalRefundMinor += Number(refund);
          reasonMap.set(rKey, currReason);

          const pId = item.saleItem.variant.product.id;
          const pName = item.saleItem.variant.product.name;
          const currProd = productReturnMap.get(pId) || { productId: pId, productName: pName, returnedUnits: 0 };
          currProd.returnedUnits += qty;
          productReturnMap.set(pId, currProd);

          itemsList.push({
            id: item.id,
            returnInvoiceNumber: ret.returnNumber,
            saleInvoiceNumber: ret.sale.invoiceNumber,
            createdAt: ret.createdAt.toISOString(),
            branchName: ret.shift?.register?.branch?.name || "Main Branch",
            productName: pName,
            variantSku: item.saleItem.variant.sku,
            quantity: qty,
            refundMinor: Number(refund),
            condition: item.condition,
            reason: ret.reason || "unspecified",
          });
        }

        if (returnIncludedInFilter) {
          const currDay = dailyMap.get(dateKey) || { date: dateKey, returnsCount: 0, totalRefundMinor: 0, units: 0 };
          currDay.returnsCount += 1;
          currDay.totalRefundMinor += Number(ret.totalRefundMinor);
          dailyMap.set(dateKey, currDay);
        }
      }

      const salesDateFilter = this.buildDateFilter(filter, tz);
      const salesItems = await tx.saleItem.findMany({
        where: {
          tenantId,
          sale: { tenantId, ...salesDateFilter },
        },
        select: {
          quantity: true,
          variant: { select: { productId: true, product: { select: { name: true } } } },
        },
      });

      const productSalesMap = new Map<string, { productId: string; productName: string; soldUnits: number }>();
      for (const si of salesItems) {
        const pId = si.variant.productId;
        const pName = si.variant.product.name;
        const curr = productSalesMap.get(pId) || { productId: pId, productName: pName, soldUnits: 0 };
        curr.soldUnits += Math.round(Number(si.quantity));
        productSalesMap.set(pId, curr);
      }

      const productReturnRates = Array.from(productReturnMap.values()).map((p) => {
        const sold = productSalesMap.get(p.productId)?.soldUnits || 0;
        const rate = sold > 0 ? Number(((p.returnedUnits / sold) * 100).toFixed(1)) : 100;
        return {
          productId: p.productId,
          productName: p.productName,
          soldUnits: sold,
          returnedUnits: p.returnedUnits,
          returnRatePercent: rate,
        };
      });

      return {
        summary: {
          returnsCount: returns.length,
          totalRefundMinor: Number(totalRefundMinor),
          totalReturnedUnits,
          resellableUnits,
          damagedUnits,
          resellableRefundMinor: Number(resellableRefundMinor),
          damagedRefundMinor: Number(damagedRefundMinor),
        },
        byDay: Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
        byReason: Array.from(reasonMap.values()),
        productReturnRates,
        items: itemsList,
      };
    });
  }

  async getDamagedStockReport(tenantId: string, filter: ReportDateFilter) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const dateRange = (filter.startDate || filter.endDate)
        ? parseDateFilterRange(filter.startDate, filter.endDate, tz)
        : null;

      // 1. Damaged sale return items
      const returnWhere: Prisma.SaleReturnItemWhereInput = {
        tenantId,
        condition: "damaged",
      };
      if (filter.branchId) {
        returnWhere.saleReturn = { branchId: filter.branchId };
      }
      if (dateRange) {
        returnWhere.createdAt = {};
        if (dateRange.gte) returnWhere.createdAt.gte = dateRange.gte;
        if (dateRange.lte) returnWhere.createdAt.lte = dateRange.lte;
      }

      const damagedReturnItems = await tx.saleReturnItem.findMany({
        where: returnWhere,
        include: {
          saleItem: true,
          variant: { include: { product: { select: { id: true, name: true } } } },
          saleReturn: {
            include: {
              shift: { include: { register: { include: { branch: true } } } },
              sale: { select: { invoiceNumber: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // 2. Transfer losses
      const transferSubWhere: Prisma.StockTransferWhereInput = {
        tenantId,
        status: "received",
      };
      if (filter.branchId) {
        transferSubWhere.destinationBranchId = filter.branchId;
      }
      if (dateRange) {
        transferSubWhere.receivedAt = {};
        if (dateRange.gte) transferSubWhere.receivedAt.gte = dateRange.gte;
        if (dateRange.lte) transferSubWhere.receivedAt.lte = dateRange.lte;
      }
      const transferWhere: Prisma.StockTransferItemWhereInput = {
        transfer: transferSubWhere,
      };

      const transferItems = await tx.stockTransferItem.findMany({
        where: transferWhere,
        include: {
          variant: { include: { product: { select: { id: true, name: true } } } },
          transfer: {
            include: {
              destinationBranch: true,
            },
          },
        },
      });

      let totalDamagedUnits = 0;
      let totalLossMinor = 0n;
      let saleReturnDamagedUnits = 0;
      let saleReturnDamagedLossMinor = 0n;
      let transferLossUnits = 0;
      let transferLossMinor = 0n;

      const items: any[] = [];

      for (const ri of damagedReturnItems) {
        const qty = Math.round(Number(ri.quantity));
        const unitCost = BigInt(ri.saleItem.unitCostMinor || ri.variant.costMinor || 0);
        const loss = unitCost * BigInt(qty);

        totalDamagedUnits += qty;
        totalLossMinor += loss;
        saleReturnDamagedUnits += qty;
        saleReturnDamagedLossMinor += loss;

        items.push({
          id: ri.id,
          createdAt: ri.createdAt.toISOString(),
          branchName: ri.saleReturn.shift?.register?.branch?.name || "Main Branch",
          productName: ri.variant.product.name,
          variantSku: ri.variant.sku,
          movementType: "sale_return_damaged",
          quantity: qty,
          unitCostMinor: Number(unitCost),
          totalLossMinor: Number(loss),
          reason: ri.saleReturn.reason || "Customer damaged return",
          referenceId: ri.saleReturn.returnNumber,
        });
      }

      for (const ti of transferItems) {
        const sent = Number(ti.sentQty);
        const received = Number(ti.receivedQty || 0);
        if (sent > received) {
          const lossQty = sent - received;
          const unitCost = BigInt(ti.variant.costMinor || 0);
          const loss = unitCost * BigInt(lossQty);

          totalDamagedUnits += lossQty;
          totalLossMinor += loss;
          transferLossUnits += lossQty;
          transferLossMinor += loss;

          items.push({
            id: ti.id,
            createdAt: (ti.transfer.receivedAt || ti.transfer.updatedAt).toISOString(),
            branchName: ti.transfer.destinationBranch.name,
            productName: ti.variant.product.name,
            variantSku: ti.variant.sku,
            movementType: "transfer_loss",
            quantity: lossQty,
            unitCostMinor: Number(unitCost),
            totalLossMinor: Number(loss),
            reason: ti.lossReason || "Transfer loss in transit",
            referenceId: ti.transfer.transferNumber,
          });
        }
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        summary: {
          totalDamagedUnits,
          totalLossMinor: Number(totalLossMinor),
          byMovementType: {
            saleReturnDamagedUnits,
            saleReturnDamagedLossMinor: Number(saleReturnDamagedLossMinor),
            transferLossUnits,
            transferLossMinor: Number(transferLossMinor),
            otherLossUnits: 0,
            otherLossMinor: 0,
          },
        },
        items,
      };
    });
  }

  async getPromotionsReport(tenantId: string, filter: ReportDateFilter) {
    const tz = await this.getTimeZone(tenantId);
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const dateFilter = this.buildDateFilter(filter, tz);
      const returnDateFilter = this.buildReturnDateFilter(filter, tz);

      const [promotions, sales, returnItems] = await Promise.all([
        tx.promotion.findMany({
          where: { tenantId },
          orderBy: { name: "asc" },
        }),
        tx.sale.findMany({
          where: { tenantId, ...dateFilter },
          include: {
            items: {
              include: { promotion: true },
            },
            billPromotion: true,
          },
          orderBy: { occurredAt: "asc" },
        }),
        tx.saleReturnItem.findMany({
          where: {
            tenantId,
            saleReturn: { tenantId, ...returnDateFilter },
          },
          include: {
            saleItem: true,
            saleReturn: {
              include: { sale: true },
            },
          },
        }),
      ]);

      const promoMap = new Map<
        string,
        {
          id: string;
          name: string;
          type: string;
          salesSet: Set<string>;
          unitsSold: number;
          grossMinor: bigint;
          discountGivenMinor: bigint;
          returnUnits: number;
          returnRefundMinor: bigint;
        }
      >();

      for (const p of promotions) {
        promoMap.set(p.id, {
          id: p.id,
          name: p.name,
          type: p.type,
          salesSet: new Set<string>(),
          unitsSold: 0,
          grossMinor: 0n,
          discountGivenMinor: 0n,
          returnUnits: 0,
          returnRefundMinor: 0n,
        });
      }

      const dailyMap = new Map<
        string,
        {
          date: string;
          salesSet: Set<string>;
          unitsSold: number;
          discountGivenMinor: bigint;
          grossMinor: bigint;
        }
      >();

      for (const s of sales) {
        let saleHasPromotion = false;
        const dateKey = formatBusinessDate(s.occurredAt || s.createdAt, tz);

        if (s.billPromotionId) {
          saleHasPromotion = true;
          let entry = promoMap.get(s.billPromotionId);
          if (!entry) {
            entry = {
              id: s.billPromotionId,
              name: s.billPromotion?.name || "Bill Promotion",
              type: s.billPromotion?.type || "BILL_THRESHOLD",
              salesSet: new Set<string>(),
              unitsSold: 0,
              grossMinor: 0n,
              discountGivenMinor: 0n,
              returnUnits: 0,
              returnRefundMinor: 0n,
            };
            promoMap.set(s.billPromotionId, entry);
          }
          entry.salesSet.add(s.id);
          entry.discountGivenMinor += s.billPromotionDiscountMinor;
          for (const it of s.items) {
            entry.unitsSold += Number(it.quantity);
            entry.grossMinor += it.subtotalMinor;
          }
        }

        for (const it of s.items) {
          if (it.promotionId) {
            saleHasPromotion = true;
            let entry = promoMap.get(it.promotionId);
            if (!entry) {
              entry = {
                id: it.promotionId,
                name: it.promotionLabel || it.promotion?.name || "Promotion",
                type: it.promotion?.type || "UNKNOWN",
                salesSet: new Set<string>(),
                unitsSold: 0,
                grossMinor: 0n,
                discountGivenMinor: 0n,
                returnUnits: 0,
                returnRefundMinor: 0n,
              };
              promoMap.set(it.promotionId, entry);
            }
            entry.salesSet.add(s.id);
            entry.unitsSold += Number(it.quantity);
            entry.grossMinor += it.subtotalMinor;
            entry.discountGivenMinor += it.promotionDiscountMinor;
          }
        }

        if (saleHasPromotion) {
          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, {
              date: dateKey,
              salesSet: new Set<string>(),
              unitsSold: 0,
              discountGivenMinor: 0n,
              grossMinor: 0n,
            });
          }
          const daily = dailyMap.get(dateKey)!;
          daily.salesSet.add(s.id);
          daily.discountGivenMinor += s.billPromotionDiscountMinor;
          for (const it of s.items) {
            if (it.promotionId || s.billPromotionId) {
              daily.unitsSold += Number(it.quantity);
              daily.grossMinor += it.subtotalMinor;
            }
            if (it.promotionId) {
              daily.discountGivenMinor += it.promotionDiscountMinor;
            }
          }
        }
      }

      for (const ri of returnItems) {
        const promoId = ri.saleItem.promotionId || ri.saleReturn.sale?.billPromotionId;
        if (promoId && promoMap.has(promoId)) {
          const entry = promoMap.get(promoId)!;
          entry.returnUnits += Number(ri.quantity);
          entry.returnRefundMinor += ri.totalRefundMinor;
        }
      }

      const items = Array.from(promoMap.values())
        .filter((p) => p.salesSet.size > 0 || p.returnUnits > 0 || p.discountGivenMinor > 0n)
        .map((p) => {
          const netMinor = p.grossMinor - p.discountGivenMinor;
          const netAfterReturnsMinor = netMinor - p.returnRefundMinor;
          return {
            promotionId: p.id,
            name: p.name,
            type: p.type,
            salesCount: p.salesSet.size,
            unitsSold: p.unitsSold,
            grossMinor: Number(p.grossMinor),
            discountGivenMinor: Number(p.discountGivenMinor),
            netMinor: Number(netMinor),
            returnUnits: p.returnUnits,
            returnRefundMinor: Number(p.returnRefundMinor),
            netAfterReturnsMinor: Number(netAfterReturnsMinor),
          };
        });

      const totalSalesSet = new Set<string>();
      let totalUnitsSold = 0;
      let totalGrossMinor = 0n;
      let totalDiscountGivenMinor = 0n;
      let totalNetMinor = 0n;
      let totalReturnUnits = 0;
      let totalReturnRefundMinor = 0n;

      for (const item of items) {
        totalUnitsSold += item.unitsSold;
        totalGrossMinor += BigInt(item.grossMinor);
        totalDiscountGivenMinor += BigInt(item.discountGivenMinor);
        totalNetMinor += BigInt(item.netMinor);
        totalReturnUnits += item.returnUnits;
        totalReturnRefundMinor += BigInt(item.returnRefundMinor);
      }

      for (const s of sales) {
        if (s.billPromotionId || s.items.some((i) => i.promotionId)) {
          totalSalesSet.add(s.id);
        }
      }

      const daily = Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({
          date: d.date,
          salesCount: d.salesSet.size,
          unitsSold: d.unitsSold,
          grossMinor: Number(d.grossMinor),
          discountGivenMinor: Number(d.discountGivenMinor),
          netMinor: Number(d.grossMinor - d.discountGivenMinor),
        }));

      return {
        summary: {
          totalSalesCount: totalSalesSet.size,
          totalUnitsSold,
          totalGrossMinor: Number(totalGrossMinor),
          totalDiscountGivenMinor: Number(totalDiscountGivenMinor),
          totalNetMinor: Number(totalNetMinor),
          totalReturnUnits,
          totalReturnRefundMinor: Number(totalReturnRefundMinor),
          netAfterReturnsMinor: Number(totalNetMinor - totalReturnRefundMinor),
        },
        items,
        daily,
      };
    });
  }

  async getLoyaltyReport(tenantId: string, _filter: ReportDateFilter) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const [setting, ledgers, customers] = await Promise.all([
        tx.loyaltySetting.findUnique({ where: { tenantId } }),
        tx.loyaltyLedger.findMany({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        }),
        tx.customer.findMany({
          where: { tenantId, loyaltyPointsBalance: { gt: 0 } },
          select: {
            id: true,
            name: true,
            phone: true,
            loyaltyPointsBalance: true,
          },
          orderBy: { loyaltyPointsBalance: "desc" },
          take: 10,
        }),
      ]);

      const pointValueMinor = Number(setting?.pointValueMinor ?? 100);
      const earnRateMinor = Number(setting?.earnRateMinor ?? 10000);

      const monthlyMap = new Map<
        string,
        {
          month: string;
          issued: number;
          redeemed: number;
          expired: number;
          reversed: number;
        }
      >();

      let totalPointsIssued = 0;
      let totalPointsRedeemed = 0;
      let totalPointsExpired = 0;
      let totalPointsReversed = 0;

      for (const entry of ledgers) {
        const d = entry.createdAt;
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            month: monthKey,
            issued: 0,
            redeemed: 0,
            expired: 0,
            reversed: 0,
          });
        }
        const m = monthlyMap.get(monthKey)!;

        switch (entry.type) {
          case "EARN":
          case "REFUND_REDEEM":
            m.issued += entry.points;
            totalPointsIssued += entry.points;
            break;
          case "REDEEM":
            m.redeemed += Math.abs(entry.points);
            totalPointsRedeemed += Math.abs(entry.points);
            break;
          case "EXPIRE":
            m.expired += Math.abs(entry.points);
            totalPointsExpired += Math.abs(entry.points);
            break;
          case "REVERSE_EARN":
            m.reversed += Math.abs(entry.points);
            totalPointsReversed += Math.abs(entry.points);
            break;
          case "ADJUST":
            if (entry.points > 0) {
              m.issued += entry.points;
              totalPointsIssued += entry.points;
            } else {
              m.reversed += Math.abs(entry.points);
              totalPointsReversed += Math.abs(entry.points);
            }
            break;
        }
      }

      const monthly = Array.from(monthlyMap.values())
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((m) => ({
          month: m.month,
          issued: m.issued,
          redeemed: m.redeemed,
          expired: m.expired,
          reversed: m.reversed,
          netChange: m.issued - m.redeemed - m.expired - m.reversed,
        }));

      const allActiveCustomers = await tx.customer.aggregate({
        where: { tenantId, loyaltyPointsBalance: { gt: 0 } },
        _sum: { loyaltyPointsBalance: true },
      });
      const totalOutstandingPoints = allActiveCustomers._sum.loyaltyPointsBalance || 0;
      const liabilityMinor = totalOutstandingPoints * pointValueMinor;

      const topCustomers = customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        pointsBalance: c.loyaltyPointsBalance,
        liabilityMinor: c.loyaltyPointsBalance * pointValueMinor,
      }));

      return {
        summary: {
          totalPointsIssued,
          totalPointsRedeemed,
          totalPointsExpired,
          totalPointsReversed,
          totalOutstandingPoints,
          liabilityMinor,
          pointValueMinor,
          earnRateMinor,
        },
        monthly,
        topCustomers,
      };
    });
  }
}
