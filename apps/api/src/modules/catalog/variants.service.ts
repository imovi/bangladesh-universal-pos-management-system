import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateBarcodeDto, UpdateVariantDto, generateEan13 } from "@universal-pos/shared";

@Injectable()
export class VariantsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a valid 13-digit EAN-13 in-store barcode using the tenant's sequence counter.
   */
  private async generateNextTenantEan13Barcode(tx: any, tenantId: string): Promise<string> {
    const counter = await tx.barcodeCounter.upsert({
      where: { tenantId },
      create: {
        tenant: { connect: { id: tenantId } },
        prefix: 200,
        lastSeq: 1,
      },
      update: {
        lastSeq: { increment: 1 },
      },
    });

    const prefix = counter.prefix || 200;
    let seq = counter.lastSeq;
    let candidate = generateEan13(prefix, seq);

    // Collision guard across any existing variant barcodes in tenant
    while (true) {
      const existing = await tx.variantBarcode.findUnique({
        where: {
          tenantId_barcode: {
            tenantId,
            barcode: candidate,
          },
        },
      });
      if (!existing) {
        break;
      }
      const bumped = await tx.barcodeCounter.update({
        where: { tenantId },
        data: { lastSeq: { increment: 1 } },
      });
      seq = bumped.lastSeq;
      candidate = generateEan13(prefix, seq);
    }

    return candidate;
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
        : await this.generateNextTenantEan13Barcode(tx, tenantId);

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

      if (dto.productUnitId) {
        const unit = await tx.productUnit.findFirst({
          where: { id: dto.productUnitId, productId: variant.productId, tenantId },
        });
        if (!unit) {
          throw new BadRequestException("এককটি এই পণ্যের জন্য প্রযোজ্য নয়।");
        }
      }

      const created = await tx.variantBarcode.create({
        data: {
          tenantId,
          variantId,
          barcode: barcodeValue,
          productUnitId: dto.productUnitId || null,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "variant.barcode_add",
        entityType: "VariantBarcode",
        entityId: created.id,
        after: { variantId, barcode: barcodeValue, productUnitId: dto.productUnitId || null },
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

  /**
   * Generates a unique in-store EAN-13 barcode for a variant if it doesn't already have one.
   * If the variant already has a barcode, the existing barcode is returned untouched.
   */
  async generateBarcodeForVariant(
    tenantId: string,
    variantId: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { barcodes: true },
      });
      if (!variant || variant.tenantId !== tenantId) {
        throw new NotFoundException(`Variant with ID ${variantId} not found`);
      }

      if (variant.barcodes && variant.barcodes.length > 0) {
        return {
          variantId,
          barcode: variant.barcodes[0].barcode,
          isNew: false,
        };
      }

      const barcode = await this.generateNextTenantEan13Barcode(tx, tenantId);
      const created = await tx.variantBarcode.create({
        data: {
          tenantId,
          variantId,
          barcode,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "variant.barcode_generate",
        entityType: "VariantBarcode",
        entityId: created.id,
        after: { variantId, barcode },
        ip,
      });

      return {
        variantId,
        barcode,
        isNew: true,
      };
    });
  }

  /**
   * Generates barcodes for all variants of a product that lack one.
   */
  async generateBarcodesForProduct(
    tenantId: string,
    productId: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: {
          variants: {
            include: { barcodes: true },
          },
        },
      });
      if (!product || product.tenantId !== tenantId) {
        throw new NotFoundException(`Product with ID ${productId} not found`);
      }

      let generatedCount = 0;
      const results: { variantId: string; barcode: string; isNew: boolean }[] = [];

      for (const variant of product.variants) {
        if (variant.barcodes && variant.barcodes.length > 0) {
          results.push({
            variantId: variant.id,
            barcode: variant.barcodes[0].barcode,
            isNew: false,
          });
        } else {
          const barcode = await this.generateNextTenantEan13Barcode(tx, tenantId);
          await tx.variantBarcode.create({
            data: {
              tenantId,
              variantId: variant.id,
              barcode,
            },
          });
          generatedCount++;
          results.push({
            variantId: variant.id,
            barcode,
            isNew: true,
          });
        }
      }

      if (generatedCount > 0) {
        await this.auditService.log(tx, {
          tenantId,
          actorUserId: userId,
          action: "product.barcodes_batch_generate",
          entityType: "Product",
          entityId: productId,
          after: { generatedCount, results },
          ip,
        });
      }

      return {
        productId,
        generatedCount,
        variants: results,
      };
    });
  }
}
