import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  OpenShiftDto,
  CloseShiftDto,
  CashMovementDto,
  calculateShiftCashTotals,
} from "@universal-pos/shared";

@Injectable()
export class ShiftsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async open(
    tenantId: string,
    dto: OpenShiftDto,
    userId: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const openShift = await tx.shift.findFirst({
        where: { tenantId, registerId: dto.registerId, status: "open" },
      });
      if (openShift) {
        throw new ConflictException("An open shift already exists on this register");
      }

      const shift = await tx.shift.create({
        data: {
          tenantId,
          registerId: dto.registerId,
          branchId: dto.branchId,
          cashierUserId: userId,
          status: "open",
          openingCashMinor: BigInt(dto.openingCashMinor),
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "shift.open",
          entityType: "shift",
          entityId: shift.id,
          after: { registerId: shift.registerId, openingCashMinor: Number(shift.openingCashMinor) },
          ip,
        },
        tx,
      );

      return shift;
    });
  }

  async addCashMovement(
    tenantId: string,
    shiftId: string,
    dto: CashMovementDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.tenantId !== tenantId) {
        throw new NotFoundException("Shift not found");
      }
      if (shift.status !== "open") {
        throw new BadRequestException("Cannot add cash movement to a closed shift");
      }

      const movement = await tx.cashMovement.create({
        data: {
          id: uuidv7(),
          tenantId,
          shiftId,
          type: dto.type,
          amountMinor: BigInt(dto.amountMinor),
          reason: dto.reason,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "shift.cash_movement",
          entityType: "cash_movement",
          entityId: movement.id,
          after: { shiftId, type: movement.type, amountMinor: Number(movement.amountMinor), reason: movement.reason },
          ip,
        },
        tx,
      );

      return movement;
    });
  }

  private async executeShiftClose(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shift: any,
    dto: CloseShiftDto,
    userId?: string,
    ip?: string,
  ) {
    const calc = calculateShiftCashTotals({
      openingCashMinor: shift.openingCashMinor,
      cashMovements: shift.cashMovements,
      sales: shift.sales,
      returns: shift.returns,
    });
    const expectedCashMinor = calc.expectedCashMinor;
    const closingCashMinor = BigInt(dto.closingCashMinor);
    const cashDifferenceMinor = closingCashMinor - expectedCashMinor;

    const updated = await tx.shift.update({
      where: { id: shift.id },
      data: {
        status: "closed",
        closingCashMinor,
        expectedCashMinor,
        cashDifferenceMinor,
        closedAt: new Date(),
        notes: dto.notes,
      },
    });

    await this.auditService.log(
      {
        tenantId,
        actorUserId: userId,
        action: "shift.close",
        entityType: "shift",
        entityId: shift.id,
        after: {
          closingCashMinor: Number(closingCashMinor),
          expectedCashMinor: Number(expectedCashMinor),
          cashDifferenceMinor: Number(cashDifferenceMinor),
        },
        ip,
      },
      tx,
    );

    const paymentMethodTotalsMinor = Object.fromEntries(
      Object.entries(calc.paymentMethodTotalsMinor).map(([k, v]) => [k, Number(v)]),
    );

    return {
      ...updated,
      paymentMethodTotalsMinor,
      returnsMinor: Number(calc.totalRefundsMinor),
      returnsCount: calc.returnsCount,
      cardSalesMinor: Number(calc.cardSalesMinor),
      bkashSalesMinor: Number(calc.bkashSalesMinor),
      otherSalesMinor: Number(calc.otherSalesMinor),
    };
  }

  async close(
    tenantId: string,
    shiftId: string,
    dto: CloseShiftDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const shift = await tx.shift.findUnique({
        where: { id: shiftId },
        include: {
          cashMovements: true,
          returns: true,
          sales: {
            where: { status: "completed" },
            include: { payments: true },
          },
        },
      });
      if (!shift || shift.tenantId !== tenantId) {
        throw new NotFoundException("Shift not found");
      }
      if (shift.status !== "open") {
        throw new BadRequestException("Shift is already closed");
      }

      return this.executeShiftClose(tx, tenantId, shift, dto, userId, ip);
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const shift = await tx.shift.findUnique({
        where: { id },
        include: {
          register: true,
          branch: true,
          cashierUser: { select: { id: true, name: true, email: true } },
          cashMovements: { orderBy: { createdAt: "asc" } },
          returns: true,
          sales: {
            where: { status: "completed" },
            include: { payments: true },
          },
        },
      });
      if (!shift || shift.tenantId !== tenantId) {
        throw new NotFoundException("Shift not found");
      }

      const calc = calculateShiftCashTotals({
        openingCashMinor: shift.openingCashMinor,
        cashMovements: shift.cashMovements,
        sales: shift.sales,
        returns: shift.returns,
      });

      const paymentMethodTotalsMinor = Object.fromEntries(
        Object.entries(calc.paymentMethodTotalsMinor).map(([k, v]) => [k, Number(v)]),
      );

      return {
        ...shift,
        summary: {
          expectedCashMinor: Number(calc.expectedCashMinor),
          cashPaymentsMinor: Number(calc.cashPaymentsMinor),
          changeGivenMinor: Number(calc.changeGivenMinor),
          netCashSalesMinor: Number(calc.netCashSalesMinor),
          cashInMinor: Number(calc.cashInMinor),
          cashOutMinor: Number(calc.cashOutMinor),
          returnsMinor: Number(calc.totalRefundsMinor),
          returnsCount: calc.returnsCount,
          completedSalesCount: calc.completedSalesCount,
          paymentMethodTotalsMinor,
          cardSalesMinor: Number(calc.cardSalesMinor),
          bkashSalesMinor: Number(calc.bkashSalesMinor),
          otherSalesMinor: Number(calc.otherSalesMinor),
        },
      };
    });
  }

  async findMany(
    tenantId: string,
    query: {
      registerId?: string;
      branchId?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.ShiftWhereInput = { tenantId };
      if (query.registerId) where.registerId = query.registerId;
      if (query.branchId) where.branchId = query.branchId;
      if (query.status) where.status = query.status;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.shift.count({ where }),
        tx.shift.findMany({
          where,
          skip,
          take: limit,
          include: {
            register: true,
            cashierUser: { select: { id: true, name: true } },
          },
          orderBy: { openedAt: "desc" },
        }),
      ]);

      return {
        items,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }
}
