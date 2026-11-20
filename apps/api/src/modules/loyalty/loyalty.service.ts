import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { v7 as uuidv7 } from "uuid";
import {
  UpdateLoyaltySettingsInput,
  AdjustLoyaltyPointsInput,
  LoyaltyLedgerQueryInput,
} from "@universal-pos/shared";

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async getSettings(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      let setting = await tx.loyaltySetting.findUnique({
        where: { tenantId },
      });

      if (!setting) {
        setting = await tx.loyaltySetting.create({
          data: {
            id: uuidv7(),
            tenantId,
            isEnabled: false,
            earnRateMinor: 10000n,
            pointValueMinor: 100n,
            minRedeemPoints: 100,
            maxBillSharePercent: 50,
            expiryMonths: 12,
          },
        });
      }

      return {
        id: setting.id,
        tenantId: setting.tenantId,
        isEnabled: setting.isEnabled,
        earnRateMinor: Number(setting.earnRateMinor),
        pointValueMinor: Number(setting.pointValueMinor),
        minRedeemPoints: setting.minRedeemPoints,
        maxBillSharePercent: setting.maxBillSharePercent,
        expiryMonths: setting.expiryMonths,
        createdAt: setting.createdAt,
        updatedAt: setting.updatedAt,
      };
    });
  }

  async updateSettings(
    tenantId: string,
    userId: string,
    dto: UpdateLoyaltySettingsInput,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.loyaltySetting.findUnique({
        where: { tenantId },
      });

      const updated = await tx.loyaltySetting.upsert({
        where: { tenantId },
        create: {
          id: uuidv7(),
          tenantId,
          isEnabled: dto.isEnabled,
          earnRateMinor: BigInt(dto.earnRateMinor),
          pointValueMinor: BigInt(dto.pointValueMinor),
          minRedeemPoints: dto.minRedeemPoints,
          maxBillSharePercent: dto.maxBillSharePercent,
          expiryMonths: dto.expiryMonths,
        },
        update: {
          isEnabled: dto.isEnabled,
          earnRateMinor: BigInt(dto.earnRateMinor),
          pointValueMinor: BigInt(dto.pointValueMinor),
          minRedeemPoints: dto.minRedeemPoints,
          maxBillSharePercent: dto.maxBillSharePercent,
          expiryMonths: dto.expiryMonths,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "tenant.loyalty_settings_update",
          entityType: "LoyaltySetting",
          entityId: updated.id,
          before: existing ? { ...existing, earnRateMinor: Number(existing.earnRateMinor), pointValueMinor: Number(existing.pointValueMinor) } : null,
          after: { ...updated, earnRateMinor: Number(updated.earnRateMinor), pointValueMinor: Number(updated.pointValueMinor) },
          ip,
        },
        tx,
      );

      return {
        id: updated.id,
        tenantId: updated.tenantId,
        isEnabled: updated.isEnabled,
        earnRateMinor: Number(updated.earnRateMinor),
        pointValueMinor: Number(updated.pointValueMinor),
        minRedeemPoints: updated.minRedeemPoints,
        maxBillSharePercent: updated.maxBillSharePercent,
        expiryMonths: updated.expiryMonths,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async getLedger(
    tenantId: string,
    customerId: string,
    query: LoyaltyLedgerQueryInput,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId, tenantId },
      });
      if (!customer) {
        throw new NotFoundException({
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer not found",
        });
      }

      const page = query.page || 1;
      const limit = query.limit || 20;
      const skip = (page - 1) * limit;

      const where: any = {
        tenantId,
        customerId,
        ...(query.type ? { type: query.type } : {}),
      };

      const [total, items] = await Promise.all([
        tx.loyaltyLedger.count({ where }),
        tx.loyaltyLedger.findMany({
          where,
          include: {
            sale: {
              select: { id: true, invoiceNumber: true, totalMinor: true },
            },
            return: {
              select: { id: true, returnNumber: true, totalRefundMinor: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          loyaltyPointsBalance: customer.loyaltyPointsBalance,
        },
        data: items.map((it) => ({
          id: it.id,
          type: it.type,
          points: it.points,
          reason: it.reason,
          expiresAt: it.expiresAt,
          createdAt: it.createdAt,
          sale: it.sale
            ? {
                id: it.sale.id,
                invoiceNumber: it.sale.invoiceNumber,
                totalMinor: Number(it.sale.totalMinor),
              }
            : null,
          return: it.return
            ? {
                id: it.return.id,
                returnNumber: it.return.returnNumber,
                totalRefundMinor: Number(it.return.totalRefundMinor),
              }
            : null,
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async adjustPoints(
    tenantId: string,
    userId: string,
    customerId: string,
    dto: AdjustLoyaltyPointsInput,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // Pessimistic lock on customer row
      const [lockedCust] = (await tx.$queryRaw`
        SELECT id, loyalty_points_balance FROM customers
        WHERE id = ${customerId}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE;
      `) as Array<{ id: string; loyalty_points_balance: number }>;

      if (!lockedCust) {
        throw new NotFoundException({
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer not found",
        });
      }

      const prevBalance = lockedCust.loyalty_points_balance;
      const newBalance = prevBalance + dto.points;

      const ledgerEntry = await tx.loyaltyLedger.create({
        data: {
          id: uuidv7(),
          tenantId,
          customerId,
          type: "ADJUST",
          points: dto.points,
          reason: dto.reason,
        },
      });

      await tx.customer.update({
        where: { id: customerId },
        data: {
          loyaltyPointsBalance: newBalance,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.loyalty_adjust",
          entityType: "Customer",
          entityId: customerId,
          before: { loyaltyPointsBalance: prevBalance },
          after: { loyaltyPointsBalance: newBalance, adjustment: dto.points, reason: dto.reason },
          ip,
        },
        tx,
      );

      return {
        customerId,
        ledgerId: ledgerEntry.id,
        adjustment: dto.points,
        previousBalance: prevBalance,
        newBalance,
        reason: dto.reason,
      };
    });
  }

  @Cron("0 3 * * *", { timeZone: "Asia/Dhaka" })
  async handleDailyExpiryCron() {
    await this.expirePointsDaily();
  }

  async expirePointsDaily(targetDate?: Date, targetTenantId?: string) {
    const now = targetDate || new Date();

    let tenantIds: string[] = [];
    if (targetTenantId) {
      tenantIds = [targetTenantId];
    } else {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: "active" },
        select: { id: true },
      });
      tenantIds = tenants.map((t) => t.id);
    }

    let totalExpiredCustomers = 0;
    let totalExpiredPoints = 0;

    for (const tenantId of tenantIds) {
      const result = await this.expirePointsForTenant(tenantId, now);
      totalExpiredCustomers += result.expiredCustomersCount;
      totalExpiredPoints += result.totalPointsExpired;
    }

    return {
      success: true,
      evaluatedAt: now,
      expiredCustomersCount: totalExpiredCustomers,
      totalPointsExpired: totalExpiredPoints,
    };
  }

  async expirePointsForTenant(tenantId: string, now: Date) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const setting = await tx.loyaltySetting.findUnique({
        where: { tenantId },
      });
      if (!setting || !setting.isEnabled) {
        return { expiredCustomersCount: 0, totalPointsExpired: 0 };
      }

      const customers = await tx.customer.findMany({
        where: {
          tenantId,
          loyaltyPointsBalance: { gt: 0 },
        },
      });

      let expiredCustomersCount = 0;
      let totalPointsExpired = 0;

      for (const customer of customers) {
        // Lock customer FOR UPDATE
        const [locked] = (await tx.$queryRaw`
          SELECT id, loyalty_points_balance FROM customers
          WHERE id = ${customer.id}::uuid AND tenant_id = ${tenantId}::uuid
          FOR UPDATE;
        `) as Array<{ id: string; loyalty_points_balance: number }>;

        if (!locked || locked.loyalty_points_balance <= 0) continue;

        // Fetch all ledger records for customer
        const ledgerEntries = await tx.loyaltyLedger.findMany({
          where: { tenantId, customerId: customer.id },
          orderBy: { createdAt: "asc" },
        });

        let earnedExpired = 0;
        let redeemedOrReversed = 0;
        let alreadyExpired = 0;

        for (const e of ledgerEntries) {
          if (e.type === "EARN") {
            if (e.expiresAt && e.expiresAt <= now) {
              earnedExpired += e.points;
            }
          } else if (e.type === "REDEEM" || e.type === "REVERSE_EARN") {
            redeemedOrReversed += Math.abs(e.points);
          } else if (e.type === "REFUND_REDEEM") {
            redeemedOrReversed -= Math.abs(e.points);
          } else if (e.type === "EXPIRE") {
            alreadyExpired += Math.abs(e.points);
          }
        }

        if (redeemedOrReversed < 0) redeemedOrReversed = 0;

        // In FIFO, redemptions/reversals consume the earliest earned batches first
        // Amount of expired points consumed by redemptions is min(earnedExpired, redeemedOrReversed)
        const unconsumedExpired = Math.max(0, earnedExpired - redeemedOrReversed);
        const shouldExpire = Math.max(0, unconsumedExpired - alreadyExpired);

        const pointsToExpire = Math.min(locked.loyalty_points_balance, shouldExpire);

        if (pointsToExpire > 0) {
          await tx.loyaltyLedger.create({
            data: {
              id: uuidv7(),
              tenantId,
              customerId: customer.id,
              type: "EXPIRE",
              points: -pointsToExpire,
              reason: "Points expired by FIFO policy",
            },
          });

          await tx.customer.update({
            where: { id: customer.id },
            data: {
              loyaltyPointsBalance: {
                decrement: pointsToExpire,
              },
            },
          });

          expiredCustomersCount += 1;
          totalPointsExpired += pointsToExpire;
        }
      }

      return {
        expiredCustomersCount,
        totalPointsExpired,
      };
    });
  }
}
