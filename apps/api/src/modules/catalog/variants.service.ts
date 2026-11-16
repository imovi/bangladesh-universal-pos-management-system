import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateBarcodeDto, UpdateVariantDto } from "@universal-pos/shared";

@Injectable()
export class VariantsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a 13-digit EAN-like internal barcode.
   */
  private generateInternalBarcode(): string {
    const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    return `200${randomDigits}`;
  }

  /**
   * Resolves a barcode or SKU to a variant in one indexed query.
   */
  async lookup(tenantId: string, code: string) {
    if (!code || !code.trim()) {
      throw new NotFoundException("Lookup code is required");
    }
    const cleanCode = code.trim();

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Try SKU match
      let variant = await tx.productVariant.findFirst({
        where: { tenantId, sku: cleanCode, isActive: true },
        include: {
          product: true,
          barcodes: true,
          optionValues: { include: { optionValue: true } },
        },
      });

      // 2. Try Barcode match if not found by SKU
      if (!variant) {
        const barcodeMatch = await tx.variantBarcode.findFirst({
          where: { tenantId, barcode: cleanCode },
          include: {
            variant: {
              include: {
                product: true,
                barcodes: true,
                optionValues: { include: { optionValue: true } },
              },
            },
          },
        });

        if (barcodeMatch && barcodeMatch.variant.isActive) {
          variant = barcodeMatch.variant;
        }
      }

      if (!variant) {
        throw new NotFoundException(`No active variant found matching code '${cleanCode}'`);
      }

      return {
        id: variant.id,
        productId: variant.productId,
        productName: variant.product.name,
        sku: variant.sku,
        priceMinor: variant.priceMinor,
        costMinor: variant.costMinor,
        reorderLevel: variant.reorderLevel,
        barcodes: variant.barcodes.map((b: any) => b.barcode),
        options: variant.optionValues.map((ov: any) => ({
          optionId: ov.optionId,
          value: ov.optionValue.value,
        })),
      };
    });
  }

  /**
   * Adds a barcode to a variant (or auto-generates if omitted).
   */
  async addBarcode(tenantId: string, variantId: string, dto: CreateBarcodeDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant || variant.tenantId !== tenantId) {
        throw new NotFoundException(`Variant with ID ${variantId} not found`);
      }

      const barcodeValue = dto.barcode && dto.barcode.trim()
        ? dto.barcode.trim()
        : this.generateInternalBarcode();

      // Check if barcode already exists in this tenant
      const existing = await tx.variantBarcode.findUnique({
        where: {
          tenantId_barcode: {
            tenantId,
            barcode: barcodeValue,
          },
        },
      });

      if (existing) {
        throw new ConflictException(`Barcode '${barcodeValue}' already assigned in this tenant`);
      }

      const created = await tx.variantBarcode.create({
        data: {
          tenantId,
          variantId,
          barcode: barcodeValue,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "variant.barcode_add",
        entityType: "VariantBarcode",
        entityId: created.id,
        after: { variantId, barcode: barcodeValue },
        ip,
      });

      return created;
    });
  }

  async removeBarcode(
    tenantId: string,
    variantId: string,
    barcodeId: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const barcode = await tx.variantBarcode.findUnique({
        where: { id: barcodeId },
      });

      if (!barcode || barcode.tenantId !== tenantId || barcode.variantId !== variantId) {
        throw new NotFoundException("Barcode not found for this variant");
      }

      await tx.variantBarcode.delete({
        where: { id: barcodeId },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "variant.barcode_remove",
        entityType: "VariantBarcode",
        entityId: barcodeId,
        before: barcode,
        ip,
      });

      return { success: true, id: barcodeId };
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateVariantDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.productVariant.findUnique({
        where: { id },
      });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Variant not found");
      }

      const updated = await tx.productVariant.update({
        where: { id },
        data: {
          priceMinor: dto.priceMinor !== undefined ? BigInt(dto.priceMinor) : undefined,
          costMinor: dto.costMinor !== undefined ? BigInt(dto.costMinor) : undefined,
          reorderLevel:
            dto.reorderLevel !== undefined
              ? new Prisma.Decimal(dto.reorderLevel)
              : undefined,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "variant.update",
        entityType: "ProductVariant",
        entityId: id,
        before: existing,
        after: updated,
        ip,
      });

      return updated;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id },
        include: {
          product: true,
          barcodes: true,
          optionValues: { include: { optionValue: true } },
        },
      });
      if (!variant || variant.tenantId !== tenantId) {
        throw new NotFoundException("Variant not found");
      }
      return variant;
    });
  }
}
