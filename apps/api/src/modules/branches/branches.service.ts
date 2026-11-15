import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateBranchDto, UpdateBranchDto } from "@universal-pos/shared";

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findMany(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.branch.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.branch.count({ where: { tenantId } }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(tenantId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId },
    });
    if (!branch) {
      throw new NotFoundException("Branch not found");
    }
    return branch;
  }

  async create(tenantId: string, dto: CreateBranchDto, actorUserId?: string) {
    const existing = await this.prisma.branch.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Branch with code '${dto.code}' already exists`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        address: dto.address || null,
        isActive: true,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "branch.create",
      entityType: "Branch",
      entityId: branch.id,
      after: { name: branch.name, code: branch.code },
    });

    return branch;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateBranchDto,
    actorUserId?: string,
  ) {
    const current = await this.findById(tenantId, id);

    if (dto.code && dto.code !== current.code) {
      const existing = await this.prisma.branch.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: dto.code,
          },
        },
      });
      if (existing) {
        throw new ConflictException(
          `Branch with code '${dto.code}' already exists`,
        );
      }
    }

    const updated = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.code ? { code: dto.code } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "branch.update",
      entityType: "Branch",
      entityId: id,
      before: {
        name: current.name,
        code: current.code,
        isActive: current.isActive,
      },
      after: {
        name: updated.name,
        code: updated.code,
        isActive: updated.isActive,
      },
    });

    return updated;
  }
}
