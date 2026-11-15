import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateSupplierPaymentDto } from "@universal-pos/shared";

@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateSupplierPaymentDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
      });
      if (!supplier || supplier.tenantId !== tenantId) {
        throw new NotFoundException("Supplier not found");
      }

      const payment = await tx.supplierPayment.create({
        data: {
          id: uuidv7(),
          tenantId,
          supplierId: dto.supplierId,
          amountMinor: BigInt(dto.amountMinor),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
          paidAt: dto.paidAt || new Date(),
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "supplier_payment.create",
          entityType: "supplier_payment",
          entityId: payment.id,
          after: {
            id: payment.id,
            supplierId: payment.supplierId,
            amountMinor: Number(payment.amountMinor),
            paymentMethod: payment.paymentMethod,
          },
          ip,
        },
        tx,
      );

      return payment;
    });
  }

  async findMany(
    tenantId: string,
    query: { supplierId?: string; page?: number; limit?: number },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SupplierPaymentWhereInput = { tenantId };
      if (query.supplierId) where.supplierId = query.supplierId;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.supplierPayment.count({ where }),
        tx.supplierPayment.findMany({
          where,
          skip,
          take: limit,
          include: {
            supplier: { select: { id: true, name: true } },
          },
          orderBy: { paidAt: "desc" },
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
