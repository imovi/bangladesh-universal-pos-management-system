import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  CreateStockTransferDto,
  SendStockTransferDto,
  ReceiveStockTransferDto,
  StockTransferQueryDto,
} from "@universal-pos/shared";

function getDhakaDateKey(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "26";
  const month = parts.find((p) => p.type === "month")?.value || "11";
  const day = parts.find((p) => p.type === "day")?.value || "17";
  return `${year}${month}${day}`;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  private async generateTransferNumber(
    tenantId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const dateKey = getDhakaDateKey();
    const counter = await tx.transferCounter.upsert({
      where: {
        tenantId_dateKey: {
          tenantId,
          dateKey,
        },
      },
      create: {
        tenant: { connect: { id: tenantId } },
        dateKey,
        lastSeq: 1,
      },
      update: {
        lastSeq: { increment: 1 },
      },
    });

    const seqStr = String(counter.lastSeq).padStart(4, "0");
    return `TRF-${dateKey}-${seqStr}`;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateStockTransferDto,
    ip?: string,
  ) {
    if (dto.sourceBranchId === dto.destinationBranchId) {
      throw new BadRequestException("Source and destination branch cannot be the same");
    }

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Validate branches belong to tenant
      const [srcBranch, destBranch] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.sourceBranchId, tenantId } }),
        tx.branch.findUnique({ where: { id: dto.destinationBranchId, tenantId } }),
      ]);
      if (!srcBranch) throw new NotFoundException("Source branch not found");
      if (!destBranch) throw new NotFoundException("Destination branch not found");

      // 2. Validate variants
      const variantIds = Array.from(new Set(dto.items.map((i) => i.variantId)));
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, tenantId },
      });
      if (variants.length !== variantIds.length) {
        throw new NotFoundException("One or more product variants not found");
      }

      // 3. Generate sequential transfer number
      const transferNumber = await this.generateTransferNumber(tenantId, tx);

      // 4. Create stock transfer record in draft status
      const createdTransfer = await tx.stockTransfer.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          transferNumber,
          notes: dto.notes,
          status: "draft",
          tenant: { connect: { id: tenantId } },
          sourceBranch: { connect: { id: dto.sourceBranchId } },
          destinationBranch: { connect: { id: dto.destinationBranchId } },
          createdByUser: { connect: { id: userId } },
        },
      });

      await tx.stockTransferItem.createMany({
        data: dto.items.map((item) => ({
          tenantId,
          transferId: createdTransfer.id,
          variantId: item.variantId,
          sentQty: new Prisma.Decimal(item.quantity),
        })),
      });

      const transfer = await tx.stockTransfer.findUniqueOrThrow({
        where: { id: createdTransfer.id, tenantId },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  optionValues: { include: { optionValue: { include: { option: true } } } },
                },
              },
            },
          },
          sourceBranch: true,
          destinationBranch: true,
          createdByUser: { select: { id: true, name: true, email: true } },
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "transfer.create",
        entityType: "stock_transfer",
        entityId: transfer.id,
        after: { transferNumber, status: "draft", itemsCount: dto.items.length },
        ip,
      });

      return transfer;
    });
  }

  async send(
    tenantId: string,
    userId: string,
    transferId: string,
    dto?: SendStockTransferDto,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId, tenantId },
        include: { items: true },
      });

      if (!transfer) {
        throw new NotFoundException("Stock transfer not found");
      }

      if (transfer.status !== "draft") {
        throw new ConflictException(`Cannot send transfer in '${transfer.status}' status. Only draft transfers can be sent.`);
      }

      // Move stock OUT of source branch in one atomic transaction
      const movements = transfer.items.map((item) => ({
        branchId: transfer.sourceBranchId,
        variantId: item.variantId,
        qtyDelta: -Number(item.sentQty),
        type: "transfer_out",
        refType: "stock_transfer",
        refId: transfer.id,
        reason: `Transfer sent: ${transfer.transferNumber}`,
        actorUserId: userId,
      }));

      await this.inventoryService.applyMovements(tenantId, tx, movements);

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: "sent",
          sentAt: new Date(),
          sentByUserId: userId,
          notes: dto?.notes || transfer.notes,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  optionValues: { include: { optionValue: { include: { option: true } } } },
                },
              },
            },
          },
          sourceBranch: true,
          destinationBranch: true,
          createdByUser: { select: { id: true, name: true, email: true } },
          sentByUser: { select: { id: true, name: true, email: true } },
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "transfer.send",
        entityType: "stock_transfer",
        entityId: transfer.id,
        before: { status: "draft" },
        after: { status: "sent", sentAt: updated.sentAt },
        ip,
      });

      return updated;
    });
  }

  async receive(
    tenantId: string,
    userId: string,
    userBranches: string[],
    isOwner: boolean,
    transferId: string,
    dto: ReceiveStockTransferDto,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId, tenantId },
        include: { items: true },
      });

      if (!transfer) {
        throw new NotFoundException("Stock transfer not found");
      }

      if (transfer.status !== "sent") {
        throw new ConflictException(`Cannot receive transfer in '${transfer.status}' status. Only sent transfers can be received.`);
      }

      // Strict Rule: Only users assigned to the destination branch (or Owner) can receive
      if (!isOwner) {
        let hasBranch = Array.isArray(userBranches) && userBranches.includes(transfer.destinationBranchId);
        if (!hasBranch) {
          const ub = await tx.userBranch.findMany({
            where: { userId, tenantId },
            select: { branchId: true },
          });
          hasBranch = ub.some((b) => b.branchId === transfer.destinationBranchId);
        }
        if (!hasBranch) {
          throw new ForbiddenException("Only users assigned to the destination branch can receive this transfer");
        }
      }

      // Map incoming items by variantId
      const receiveMap = new Map<string, { receivedQty: number; lossReason?: string }>();
      for (const item of dto.items) {
        receiveMap.set(item.variantId, {
          receivedQty: item.receivedQty,
          lossReason: item.lossReason,
        });
      }

      const transferInMovements: Array<{
        branchId: string;
        variantId: string;
        qtyDelta: number;
        type: string;
        refType: string;
        refId: string;
        reason: string;
        actorUserId: string;
      }> = [];

      let hasLoss = false;

      for (const transferItem of transfer.items) {
        const received = receiveMap.get(transferItem.variantId);
        const receivedQty = received !== undefined ? received.receivedQty : Number(transferItem.sentQty);
        const sentQty = Number(transferItem.sentQty);

        if (receivedQty < 0) {
          throw new BadRequestException("Received quantity cannot be negative");
        }
        if (receivedQty > sentQty) {
          throw new BadRequestException(`Received quantity (${receivedQty}) cannot exceed sent quantity (${sentQty})`);
        }

        const lossQty = sentQty - receivedQty;
        const lossReason = received?.lossReason || dto.lossReason || null;

        if (lossQty > 0) {
          hasLoss = true;
          if (!lossReason || lossReason.trim().length === 0) {
            throw new BadRequestException(
              `Loss reason is required for discrepancy on variant ${transferItem.variantId} (sent: ${sentQty}, received: ${receivedQty})`,
            );
          }
        }

        // Update transfer item
        await tx.stockTransferItem.update({
          where: { id: transferItem.id },
          data: {
            receivedQty: new Prisma.Decimal(receivedQty),
            lossQty: new Prisma.Decimal(lossQty),
            lossReason,
          },
        });

        // Add received stock to destination branch
        if (receivedQty > 0) {
          transferInMovements.push({
            branchId: transfer.destinationBranchId,
            variantId: transferItem.variantId,
            qtyDelta: receivedQty,
            type: "transfer_in",
            refType: "stock_transfer",
            refId: transfer.id,
            reason: `Transfer received: ${transfer.transferNumber}`,
            actorUserId: userId,
          });
        }

        // Record loss movement in audit ledger if loss occurred
        if (lossQty > 0) {
          transferInMovements.push({
            branchId: transfer.destinationBranchId,
            variantId: transferItem.variantId,
            qtyDelta: 0, // does not affect destination stock balance directly
            type: "transfer_loss",
            refType: "stock_transfer",
            refId: transfer.id,
            reason: `Transfer loss (${lossQty} pcs): ${lossReason}`,
            actorUserId: userId,
          });
        }
      }

      if (transferInMovements.length > 0) {
        await this.inventoryService.applyMovements(tenantId, tx, transferInMovements);
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: "received",
          receivedAt: new Date(),
          receivedByUserId: userId,
          notes: dto.notes || transfer.notes,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  optionValues: { include: { optionValue: { include: { option: true } } } },
                },
              },
            },
          },
          sourceBranch: true,
          destinationBranch: true,
          createdByUser: { select: { id: true, name: true, email: true } },
          sentByUser: { select: { id: true, name: true, email: true } },
          receivedByUser: { select: { id: true, name: true, email: true } },
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "transfer.receive",
        entityType: "stock_transfer",
        entityId: transfer.id,
        before: { status: "sent" },
        after: { status: "received", receivedAt: updated.receivedAt, hasLoss },
        ip,
      });

      return updated;
    });
  }

  async cancel(
    tenantId: string,
    userId: string,
    transferId: string,
    reason?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId, tenantId },
      });

      if (!transfer) {
        throw new NotFoundException("Stock transfer not found");
      }

      // Rule: cancel only from draft
      if (transfer.status !== "draft") {
        throw new BadRequestException(
          `Only draft transfers can be cancelled. Current status is '${transfer.status}'.`,
        );
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: "cancelled",
          notes: reason ? `${transfer.notes ? transfer.notes + "\n" : ""}Cancelled: ${reason}` : transfer.notes,
        },
        include: {
          items: true,
          sourceBranch: true,
          destinationBranch: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "transfer.cancel",
        entityType: "stock_transfer",
        entityId: transfer.id,
        before: { status: "draft" },
        after: { status: "cancelled", reason },
        ip,
      });

      return updated;
    });
  }

  async findAll(tenantId: string, query: StockTransferQueryDto) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.StockTransferWhereInput = { tenantId };

      if (query.status) {
        where.status = query.status;
      }

      if (query.branchId) {
        where.OR = [
          { sourceBranchId: query.branchId },
          { destinationBranchId: query.branchId },
        ];
      } else {
        if (query.sourceBranchId) where.sourceBranchId = query.sourceBranchId;
        if (query.destinationBranchId) where.destinationBranchId = query.destinationBranchId;
      }

      if (query.search) {
        const s = query.search.trim();
        where.transferNumber = { contains: s, mode: "insensitive" };
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const skip = (page - 1) * limit;

      const orderBy: Prisma.StockTransferOrderByWithRelationInput = {};
      if (query.sortBy === "transferNumber") {
        orderBy.transferNumber = query.sortOrder;
      } else if (query.sortBy === "status") {
        orderBy.status = query.sortOrder;
      } else {
        orderBy.createdAt = query.sortOrder;
      }

      const [total, items] = await Promise.all([
        tx.stockTransfer.count({ where }),
        tx.stockTransfer.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            sourceBranch: { select: { id: true, name: true, code: true } },
            destinationBranch: { select: { id: true, name: true, code: true } },
            createdByUser: { select: { id: true, name: true } },
            sentByUser: { select: { id: true, name: true } },
            receivedByUser: { select: { id: true, name: true } },
            items: {
              include: {
                variant: {
                  include: {
                    product: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        }),
      ]);

      return {
        items: items.map((t) => {
          const totalSentQty = t.items.reduce((sum, i) => sum + Number(i.sentQty), 0);
          const totalReceivedQty = t.items.reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);
          const totalLossQty = t.items.reduce((sum, i) => sum + Number(i.lossQty || 0), 0);

          return {
            ...t,
            totalSentQty,
            totalReceivedQty,
            totalLossQty,
            itemsCount: t.items.length,
          };
        }),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id, tenantId },
        include: {
          sourceBranch: true,
          destinationBranch: true,
          createdByUser: { select: { id: true, name: true, email: true } },
          sentByUser: { select: { id: true, name: true, email: true } },
          receivedByUser: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  barcodes: true,
                  optionValues: {
                    include: {
                      optionValue: {
                        include: { option: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!transfer) {
        throw new NotFoundException("Stock transfer not found");
      }

      return transfer;
    });
  }

  async getInTransitQuantities(tenantId: string, branchId?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.StockTransferWhereInput = {
        tenantId,
        status: "sent",
      };
      if (branchId) {
        where.destinationBranchId = branchId;
      }

      const transfers = await tx.stockTransfer.findMany({
        where,
        include: { items: true },
      });

      const inTransitByVariant = new Map<string, number>();
      for (const t of transfers) {
        for (const item of t.items) {
          const current = inTransitByVariant.get(item.variantId) || 0;
          inTransitByVariant.set(item.variantId, current + Number(item.sentQty));
        }
      }

      return Object.fromEntries(inTransitByVariant.entries());
    });
  }
}
