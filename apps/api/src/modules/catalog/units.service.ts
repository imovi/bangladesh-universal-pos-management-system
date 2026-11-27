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
  CreateProductUnitDto,
  UpdateProductUnitDto,
  SetVariantUnitPriceDto,
} from "@universal-pos/shared";

@Injectable()
export class UnitsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async listUnits(tenantId: string, productId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId, tenantId },
      });
      if (!product) {
        throw new NotFoundException("পণ্য পাওয়া যায়নি।");
      }

      const units = await tx.productUnit.findMany({
        where: { productId, tenantId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          unitPrices: true,
        },
      });

      return units.map((u) => ({
        ...u,
        factor: Number(u.factor),
        unitPrices: u.unitPrices.map((up) => ({
          ...up,
          priceMinor: Number(up.priceMinor),
        })),
      }));
    });
  }

  async createUnit(
    tenantId: string,
    productId: string,
    dto: CreateProductUnitDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId, tenantId },
      });
      if (!product) {
        throw new NotFoundException("পণ্য পাওয়া যায়নি।");
      }

      // Name is unique per product
      const existing = await tx.productUnit.findUnique({
        where: {
          productId_name: { productId, name: dto.name },
        },
      });
      if (existing) {
        throw new ConflictException({
          code: "UNIT_NAME_EXISTS",
          message: `এই পণ্যের জন্য '${dto.name}' নামের একক ইতোমধ্যে বিদ্যমান।`,
        });
      }

      const unit = await tx.productUnit.create({
        data: {
          id: uuidv7(),
          tenantId,
          productId,
          name: dto.name,
          factor: new Prisma.Decimal(dto.factor),
          isSaleUnit: dto.isSaleUnit ?? true,
          isPurchaseUnit: dto.isPurchaseUnit ?? true,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      if (userId) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "catalog.unit_create",
          entityType: "product_unit",
          entityId: unit.id,
          after: { ...unit, factor: Number(unit.factor) },
          ip,
        });
      }

      return {
        ...unit,
        factor: Number(unit.factor),
      };
    });
  }

  async updateUnit(
    tenantId: string,
    productId: string,
    unitId: string,
    dto: UpdateProductUnitDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const unit = await tx.productUnit.findFirst({
        where: { id: unitId, productId, tenantId },
      });
      if (!unit) {
        throw new NotFoundException("একক পাওয়া যায়নি।");
      }

      // Changing a unit's factor is allowed only while no sale or purchase line uses it
      if (dto.factor !== undefined && dto.factor !== Number(unit.factor)) {
        const [salesUsing, poUsing, grUsing] = await Promise.all([
          tx.saleItem.count({ where: { tenantId, productUnitId: unitId } }),
          tx.purchaseOrderItem.count({ where: { tenantId, productUnitId: unitId } }),
          tx.goodsReceiptItem.count({ where: { tenantId, productUnitId: unitId } }),
        ]);

        if (salesUsing > 0 || poUsing > 0 || grUsing > 0) {
          throw new ConflictException({
            code: "UNIT_IN_USE",
            message:
              "বিক্রয় বা ক্রয়ে ব্যবহৃত এককের রূপান্তর হার (factor) পরিবর্তন করা যাবে না। অনুগ্রহ করে নতুন একক তৈরি করুন।",
          });
        }
      }

      // Check name uniqueness if changed
      if (dto.name && dto.name !== unit.name) {
        const existing = await tx.productUnit.findUnique({
          where: {
            productId_name: { productId, name: dto.name },
          },
        });
        if (existing && existing.id !== unitId) {
          throw new ConflictException({
            code: "UNIT_NAME_EXISTS",
            message: `এই পণ্যের জন্য '${dto.name}' নামের একক ইতোমধ্যে বিদ্যমান।`,
          });
        }
      }

      const updated = await tx.productUnit.update({
        where: { id: unitId },
        data: {
          name: dto.name,
          factor: dto.factor !== undefined ? new Prisma.Decimal(dto.factor) : undefined,
          isSaleUnit: dto.isSaleUnit,
          isPurchaseUnit: dto.isPurchaseUnit,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      });

      if (userId) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "catalog.unit_update",
          entityType: "product_unit",
          entityId: unit.id,
          before: { ...unit, factor: Number(unit.factor) },
          after: { ...updated, factor: Number(updated.factor) },
          ip,
        });
      }

      return {
        ...updated,
        factor: Number(updated.factor),
      };
    });
  }

  async deactivateUnit(
    tenantId: string,
    productId: string,
    unitId: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const unit = await tx.productUnit.findFirst({
        where: { id: unitId, productId, tenantId },
      });
      if (!unit) {
        throw new NotFoundException("একক পাওয়া যায়নি।");
      }

      const updated = await tx.productUnit.update({
        where: { id: unitId },
        data: { isActive: false },
      });

      if (userId) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "catalog.unit_deactivate",
          entityType: "product_unit",
          entityId: unit.id,
          before: { isActive: unit.isActive },
          after: { isActive: false },
          ip,
        });
      }

      return {
        ...updated,
        factor: Number(updated.factor),
      };
    });
  }

  async setVariantUnitPrice(
    tenantId: string,
    variantId: string,
    unitId: string,
    dto: SetVariantUnitPriceDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId, tenantId },
        include: { product: true },
      });
      if (!variant) {
        throw new NotFoundException("ভেরিয়েন্ট পাওয়া যায়নি।");
      }

      const unit = await tx.productUnit.findUnique({
        where: { id: unitId, tenantId },
      });
      if (!unit) {
        throw new NotFoundException("একক পাওয়া যায়নি।");
      }

      if (unit.productId !== variant.productId) {
        throw new BadRequestException({
          code: "UNIT_PRODUCT_MISMATCH",
          message: "এককটি এই পণ্যের ভেরিয়েন্টের জন্য প্রযোজ্য নয়।",
        });
      }

      const priceMinor = BigInt(dto.priceMinor);
      const record = await tx.variantUnitPrice.upsert({
        where: {
          variantId_productUnitId: { variantId, productUnitId: unitId },
        },
        create: {
          id: uuidv7(),
          tenantId,
          variantId,
          productUnitId: unitId,
          priceMinor,
        },
        update: {
          priceMinor,
        },
      });

      if (userId) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "catalog.variant_unit_price_set",
          entityType: "variant_unit_price",
          entityId: record.id,
          after: { variantId, productUnitId: unitId, priceMinor: Number(priceMinor) },
          ip,
        });
      }

      return {
        ...record,
        priceMinor: Number(record.priceMinor),
      };
    });
  }

  async clearVariantUnitPrice(
    tenantId: string,
    variantId: string,
    unitId: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.variantUnitPrice.findUnique({
        where: {
          variantId_productUnitId: { variantId, productUnitId: unitId },
        },
      });
      if (!existing || existing.tenantId !== tenantId) {
        return { success: true };
      }

      await tx.variantUnitPrice.delete({
        where: { id: existing.id },
      });

      if (userId) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "catalog.variant_unit_price_clear",
          entityType: "variant_unit_price",
          entityId: existing.id,
          before: { variantId, productUnitId: unitId, priceMinor: Number(existing.priceMinor) },
          ip,
        });
      }

      return { success: true };
    });
  }
}
