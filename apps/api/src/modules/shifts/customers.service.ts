import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CreateCustomerPaymentDto,
  CustomerStatementQueryDto,
  normalizePhone,
} from "@universal-pos/shared";

export interface CustomerLedgerEntry {
  id: string;
  type: "sale" | "payment" | "return";
  date: Date;
  reference: string;
  debitMinor: bigint;
  creditMinor: bigint;
  amountMinor: bigint;
  description?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private async checkPhoneConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    phone: string,
  ) {
    const existing = await tx.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) {
      throw new ConflictException(`Customer with phone ${phone} already exists`);
    }
  }

  async create(
    tenantId: string,
    dto: CreateCustomerDto,
    userId?: string,
    ip?: string,
  ) {
    const normalizedPhone = normalizePhone(dto.phone);

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      await this.checkPhoneConflict(tx, tenantId, normalizedPhone);

      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: dto.name,
          phone: normalizedPhone,
          email: dto.email || null,
          address: dto.address,
          notes: dto.notes,
          creditLimitMinor: dto.creditLimitMinor !== undefined ? BigInt(dto.creditLimitMinor) : 0n,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.create",
          entityType: "customer",
          entityId: customer.id,
          after: customer as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return customer;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomerDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.customer.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Customer not found");
      }

      let phone = existing.phone;
      if (dto.phone) {
        const normalized = normalizePhone(dto.phone);
        if (normalized !== existing.phone) {
          await this.checkPhoneConflict(tx, tenantId, normalized);
          phone = normalized;
        }
      }

      const updated = await tx.customer.update({
        where: { id },
        data: {
          name: dto.name,
          phone,
          email: dto.email !== undefined ? dto.email || null : undefined,
          address: dto.address,
          notes: dto.notes,
          creditLimitMinor: dto.creditLimitMinor !== undefined ? BigInt(dto.creditLimitMinor) : undefined,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.update",
          entityType: "customer",
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
      const customer = await tx.customer.findUnique({
        where: { id },
      });
      if (!customer || customer.tenantId !== tenantId) {
        throw new NotFoundException("Customer not found");
      }
      return customer;
    });
  }

  async findMany(
    tenantId: string,
    query: {
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.CustomerWhereInput = { tenantId };
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
        ];
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["name", "createdAt", "totalSpentMinor", "totalVisits"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, rawItems] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({
          where,
          skip,
          take: limit,
          orderBy: sortBy === "dueBalance" ? { createdAt: sortOrder } : { [sortBy]: sortOrder },
          include: {
            sales: {
              where: { status: "completed", dueMinor: { gt: 0n } },
              select: { dueMinor: true },
            },
          },
        }),
      ]);

      const items = rawItems.map((c) => {
        const totalDueMinor = c.sales.reduce((sum, s) => sum + s.dueMinor, 0n);
        const { sales: _sales, ...rest } = c;
        return {
          ...rest,
          creditLimitMinor: Number(c.creditLimitMinor),
          currentDueMinor: Number(totalDueMinor),
        };
      });

      if (sortBy === "dueBalance") {
        items.sort((a, b) =>
          sortOrder === "asc"
            ? a.currentDueMinor - b.currentDueMinor
            : b.currentDueMinor - a.currentDueMinor,
        );
      }

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

  /**
   * Generates sequential customer payment number: ${branchCode}-PAY-${dateKey}-${seq}
   */
  private async getNextPaymentNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    branchCode: string,
  ): Promise<string> {
    const now = new Date();
    const dateKey = now.toISOString().slice(2, 10).replace(/-/g, "");

    const counter = await tx.customerPaymentCounter.upsert({
      where: {
        tenantId_branchId_dateKey: {
          tenantId,
          branchId,
          dateKey,
        },
      },
      create: {
        tenantId,
        branchId,
        dateKey,
        lastSeq: 1,
      },
      update: {
        lastSeq: { increment: 1 },
      },
    });

    const seqStr = String(counter.lastSeq).padStart(4, "0");
    return `${branchCode}-PAY-${dateKey}-${seqStr}`;
  }

  /**
   * Shared transaction ledger for customer balance and statement.
   * Accurately factors in sales, credit collections, and return due reductions.
   */
  async getCustomerTransactions(
    tenantId: string,
    customerId: string,
    tx: Prisma.TransactionClient,
  ) {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException("Customer not found");
    }

    // 1. All non-voided sales for this customer
    const sales = await tx.sale.findMany({
      where: {
        tenantId,
        customerId,
        status: { not: "voided" },
      },
      include: {
        branch: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // 2. All collections / payments
    const payments = await tx.customerPayment.findMany({
      where: {
        tenantId,
        customerId,
      },
      include: {
        branch: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // 3. All returns on customer's sales
    const returns = await tx.saleReturn.findMany({
      where: {
        tenantId,
        sale: {
          customerId,
          status: { not: "voided" },
        },
      },
      include: {
        sale: { select: { invoiceNumber: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const entries: CustomerLedgerEntry[] = [];

    for (const s of sales) {
      const initialDue = BigInt(s.totalMinor) - BigInt(s.paidMinor);
      if (initialDue > 0n) {
        entries.push({
          id: s.id,
          type: "sale",
          date: s.createdAt,
          reference: s.invoiceNumber,
          debitMinor: initialDue,
          creditMinor: 0n,
          amountMinor: BigInt(s.totalMinor),
          description: `Credit Sale ${s.invoiceNumber} (Total: ৳${(Number(s.totalMinor) / 100).toFixed(2)}, Paid: ৳${(Number(s.paidMinor) / 100).toFixed(2)})`,
        });
      }
    }

    for (const p of payments) {
      entries.push({
        id: p.id,
        type: "payment",
        date: p.createdAt,
        reference: p.paymentNumber,
        debitMinor: 0n,
        creditMinor: BigInt(p.amountMinor),
        amountMinor: BigInt(p.amountMinor),
        description: `Due Collection (${p.paymentMethod.toUpperCase()})${p.reference ? ` Ref: ${p.reference}` : ""}`,
      });
    }

    for (const r of returns) {
      let dueReduced = 0n;
      const text = r.reason || "";
      if (text.includes("due_reduced:")) {
        const match = text.match(/due_reduced:(\d+)/);
        if (match) {
          dueReduced = BigInt(match[1]);
        }
      }
      if (dueReduced > 0n) {
        entries.push({
          id: r.id,
          type: "return",
          date: r.createdAt,
          reference: r.returnNumber,
          debitMinor: 0n,
          creditMinor: dueReduced,
          amountMinor: BigInt(r.totalRefundMinor),
          description: `Return on ${r.sale.invoiceNumber}: Due Adjusted`,
        });
      }
    }

    entries.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    return { customer, entries };
  }

  /**
   * GET /customers/:id/balance
   */
  async getBalance(
    tenantId: string,
    customerId: string,
    existingTx?: Prisma.TransactionClient,
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      const { customer, entries } = await this.getCustomerTransactions(tenantId, customerId, tx);
      const totalDebits = entries.reduce((sum, e) => sum + e.debitMinor, 0n);
      const totalCredits = entries.reduce((sum, e) => sum + e.creditMinor, 0n);
      const currentDueMinor = totalDebits > totalCredits ? totalDebits - totalCredits : 0n;
      const creditLimitMinor = BigInt(customer.creditLimitMinor);
      const availableCreditMinor = creditLimitMinor > currentDueMinor ? creditLimitMinor - currentDueMinor : 0n;

      return {
        customerId,
        creditLimitMinor: Number(creditLimitMinor),
        totalSalesDueMinor: Number(totalDebits),
        totalCollectedMinor: Number(totalCredits),
        currentDueMinor: Number(currentDueMinor),
        availableCreditMinor: Number(availableCreditMinor),
      };
    };

    if (existingTx) {
      return run(existingTx);
    }
    return this.tenantContext.runWithTenant(tenantId, run);
  }

  /**
   * GET /customers/:id/statement
   */
  async getStatement(
    tenantId: string,
    customerId: string,
    query: CustomerStatementQueryDto,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const { customer, entries } = await this.getCustomerTransactions(tenantId, customerId, tx);

      const start = query.startDate ? new Date(query.startDate) : null;
      const end = query.endDate ? new Date(query.endDate) : null;

      let openingBalanceMinor = 0n;
      const filtered: typeof entries = [];

      for (const e of entries) {
        if (start && e.date < start) {
          openingBalanceMinor += e.debitMinor - e.creditMinor;
        } else if (end && e.date > end) {
          // beyond range
        } else {
          filtered.push(e);
        }
      }

      let running = openingBalanceMinor;
      const itemsWithRunningBalance = filtered.map((e) => {
        running += e.debitMinor - e.creditMinor;
        return {
          id: e.id,
          type: e.type,
          date: e.date.toISOString(),
          reference: e.reference,
          debitMinor: Number(e.debitMinor),
          creditMinor: Number(e.creditMinor),
          amountMinor: Number(e.amountMinor),
          runningBalanceMinor: Number(running),
          description: e.description,
        };
      });

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const skip = (page - 1) * limit;
      const paginatedItems = itemsWithRunningBalance.slice(skip, skip + limit);
      const total = itemsWithRunningBalance.length;

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          creditLimitMinor: Number(customer.creditLimitMinor),
        },
        openingBalanceMinor: Number(openingBalanceMinor),
        closingBalanceMinor: Number(running),
        items: paginatedItems,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  /**
   * POST /customers/:id/payments
   * Records a customer due collection with FIFO allocation against unpaid due sales.
   */
  async createPayment(
    tenantId: string,
    customerId: string,
    dto: CreateCustomerPaymentDto,
    userId: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Verify customer
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer || customer.tenantId !== tenantId) {
        throw new NotFoundException("Customer not found");
      }

      // 2. Verify shift
      const shift = await tx.shift.findUnique({
        where: { id: dto.shiftId },
        include: { branch: true },
      });
      if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
        throw new BadRequestException("Active open shift is required to record customer payment");
      }

      // 3. Generate sequential payment number
      const paymentNumber = await this.getNextPaymentNumber(
        tx,
        tenantId,
        shift.branchId,
        shift.branch.code,
      );

      // 4. Create Payment record
      const payment = await tx.customerPayment.create({
        data: {
          id: dto.id,
          tenantId,
          customerId,
          shiftId: dto.shiftId,
          branchId: shift.branchId,
          receivedByUserId: userId,
          paymentNumber,
          amountMinor: BigInt(dto.amountMinor),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
        },
      });

      // 5. FIFO allocation to customer's outstanding sales with dueMinor > 0
      const unpaidSales = await tx.sale.findMany({
        where: {
          tenantId,
          customerId,
          status: "completed",
          dueMinor: { gt: 0n },
        },
        orderBy: { createdAt: "asc" },
      });

      let remainingToAllocate = BigInt(dto.amountMinor);
      const allocations: Array<{ saleId: string; amountMinor: number; allocatedMinor: number }> = [];

      for (const sale of unpaidSales) {
        if (remainingToAllocate <= 0n) break;

        const alloc = remainingToAllocate < sale.dueMinor ? remainingToAllocate : sale.dueMinor;
        await tx.customerPaymentAllocation.create({
          data: {
            tenantId,
            paymentId: payment.id,
            saleId: sale.id,
            amountMinor: alloc,
          },
        });

        await tx.sale.update({
          where: { id: sale.id },
          data: {
            dueMinor: sale.dueMinor - alloc,
          },
        });

        allocations.push({
          saleId: sale.id,
          amountMinor: Number(alloc),
          allocatedMinor: Number(alloc),
        });

        remainingToAllocate -= alloc;
      }

      // 6. Audit log
      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.payment",
          entityType: "customer_payment",
          entityId: payment.id,
          after: {
            paymentNumber,
            amountMinor: dto.amountMinor,
            paymentMethod: dto.paymentMethod,
            customerId,
            allocations,
          },
          ip,
        },
        tx,
      );

      // 7. Get updated balance
      const updatedBalance = await this.getBalance(tenantId, customerId, tx);

      return {
        id: payment.id,
        paymentNumber: payment.paymentNumber,
        customerId: payment.customerId,
        shiftId: payment.shiftId,
        branchId: payment.branchId,
        amountMinor: Number(payment.amountMinor),
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        notes: payment.notes,
        createdAt: payment.createdAt.toISOString(),
        allocations,
        customerBalance: updatedBalance,
      };
    });
  }
}
