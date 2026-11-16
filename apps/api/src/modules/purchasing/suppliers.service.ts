import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateSupplierDto, UpdateSupplierDto } from "@universal-pos/shared";

@Injectable()
export class SuppliersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateSupplierDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          tenantId,
          name: dto.name,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email || null,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "supplier.create",
          entityType: "supplier",
          entityId: supplier.id,
          after: supplier as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return supplier;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSupplierDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.supplier.findUnique({
        where: { id },
      });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Supplier not found");
      }

      const updated = await tx.supplier.update({
        where: { id },
        data: {
          name: dto.name,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email !== undefined ? dto.email || null : undefined,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "supplier.update",
          entityType: "supplier",
          entityId: id,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
      });
      if (!supplier || supplier.tenantId !== tenantId) {
        throw new NotFoundException("Supplier not found");
      }
      return supplier;
    });
  }

  async findMany(
    tenantId: string,
    query: {
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SupplierWhereInput = { tenantId };
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
          { contactName: { contains: query.search, mode: "insensitive" } },
        ];
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["name", "createdAt", "updatedAt"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, items] = await Promise.all([
        tx.supplier.count({ where }),
        tx.supplier.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
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

  private async getSupplierTransactions(
    tenantId: string,
    supplierId: string,
    tx: Prisma.TransactionClient,
  ) {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.tenantId !== tenantId) {
      throw new NotFoundException("Supplier not found");
    }

    const receipts = await tx.goodsReceipt.findMany({
      where: {
        tenantId,
        OR: [{ supplierId }, { purchaseOrder: { supplierId } }],
      },
      include: { items: true },
      orderBy: { receivedAt: "asc" },
    });

    const payments = await tx.supplierPayment.findMany({
      where: { tenantId, supplierId },
      orderBy: { paidAt: "asc" },
    });

    const receiptTx = receipts.map((r) => {
      let totalMinor = 0n;
      for (const item of r.items) {
        const qty = Number(item.qtyReceived);
        const unitCost = BigInt(item.unitCostMinor);
        totalMinor += BigInt(Math.round(qty * Number(unitCost)));
      }
      return {
        id: r.id,
        type: "goods_receipt",
        date: r.receivedAt,
        reference: r.grnNumber,
        debitMinor: totalMinor,
        creditMinor: 0n,
        amountMinor: totalMinor,
      };
    });

    const paymentTx = payments.map((p) => ({
      id: p.id,
      type: "payment",
      date: p.paidAt,
      reference: p.reference || p.paymentMethod,
      debitMinor: 0n,
      creditMinor: BigInt(p.amountMinor),
      amountMinor: BigInt(p.amountMinor),
    }));

    const allTx = [...receiptTx, ...paymentTx].sort((a, b) => {
      const timeDiff = a.date.getTime() - b.date.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    return { supplier, allTx };
  }

  async getBalance(tenantId: string, supplierId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const { allTx } = await this.getSupplierTransactions(tenantId, supplierId, tx);
      const totalReceivedMinor = allTx
        .filter((t) => t.type === "goods_receipt")
        .reduce((sum, t) => sum + t.debitMinor, 0n);
      const totalPaidMinor = allTx
        .filter((t) => t.type === "payment")
        .reduce((sum, t) => sum + t.creditMinor, 0n);
      const currentBalanceMinor = totalReceivedMinor - totalPaidMinor;

      return {
        supplierId,
        totalReceivedMinor: Number(totalReceivedMinor),
        totalPaidMinor: Number(totalPaidMinor),
        currentBalanceMinor: Number(currentBalanceMinor),
      };
    });
  }

  async getStatement(
    tenantId: string,
    supplierId: string,
    query: {
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const { allTx } = await this.getSupplierTransactions(tenantId, supplierId, tx);
      const start = query.startDate ? new Date(query.startDate) : undefined;
      const end = query.endDate ? new Date(query.endDate) : undefined;

      let baseOpeningBalance = 0n;
      const candidateTx: typeof allTx = [];

      for (const t of allTx) {
        if (start && t.date < start) {
          baseOpeningBalance = baseOpeningBalance + t.debitMinor - t.creditMinor;
        } else if (end && t.date > end) {
          // past end date
        } else {
          candidateTx.push(t);
        }
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      let pageOpeningBalance = baseOpeningBalance;
      for (let i = 0; i < Math.min(skip, candidateTx.length); i++) {
        const prev = candidateTx[i];
        pageOpeningBalance = pageOpeningBalance + prev.debitMinor - prev.creditMinor;
      }

      const pageSlice = candidateTx.slice(skip, skip + limit);
      let running = pageOpeningBalance;
      const items = pageSlice.map((t) => {
        running = running + t.debitMinor - t.creditMinor;
        return {
          id: t.id,
          type: t.type,
          date: t.date,
          reference: t.reference,
          debitMinor: Number(t.debitMinor),
          creditMinor: Number(t.creditMinor),
          amountMinor: Number(t.amountMinor),
          runningBalanceMinor: Number(running),
        };
      });

      return {
        supplierId,
        openingBalanceMinor: Number(pageOpeningBalance),
        closingBalanceMinor: Number(running),
        items,
        meta: {
          page,
          limit,
          total: candidateTx.length,
          totalPages: Math.ceil(candidateTx.length / limit),
        },
      };
    });
  }
}
