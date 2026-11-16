import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateProductDto,
  UpdateProductDto,
  BulkPriceUpdateDto,
  ProductOptionInputDto,
} from "@universal-pos/shared";

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates cartesian product of option values.
   */
  private generateCombinations(
    options: ProductOptionInputDto[],
  ): string[][] {
    if (!options || options.length === 0) return [];
    return options.reduce<string[][]>(
      (acc, opt) => {
        const next: string[][] = [];
        for (const item of acc) {
          for (const val of opt.values) {
            next.push([...item, val]);
          }
        }
        return next;
      },
      [[]],
    );
  }

  /**
   * Creates a product, its options, option values, and initial variants atomically.
   */
  async create(tenantId: string, dto: CreateProductDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Create Product
      const product = await tx.product.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description || null,
          categoryId: dto.categoryId || null,
          brandId: dto.brandId || null,
          collectionId: dto.collectionId || null,
          taxClassId: dto.taxClassId || null,
          trackingMode: dto.trackingMode || "none",
          customFields: (dto.customFields as any) || {},
        },
      });

      const optionsInput = dto.options || [];
      const createdOptions: any[] = [];

      // 2. Create Options and Option Values
      for (let i = 0; i < optionsInput.length; i++) {
        const opt = optionsInput[i];
        const createdOption = await tx.productOption.create({
          data: {
            tenantId,
            productId: product.id,
            name: opt.name,
            position: i,
          },
        });

        const createdValues: any[] = [];
        for (let j = 0; j < opt.values.length; j++) {
          const val = opt.values[j];
          const createdVal = await tx.productOptionValue.create({
            data: {
              tenantId,
              optionId: createdOption.id,
              value: val,
              position: j,
            },
          });
          createdValues.push(createdVal);
        }

        createdOptions.push({
          ...createdOption,
          values: createdValues,
        });
      }

      // 3. Generate Variants
      const combinations = this.generateCombinations(optionsInput);
      const createdVariants: any[] = [];

      if (dto.variants && dto.variants.length > 0) {
        for (const vDto of dto.variants) {
          const variant = await tx.productVariant.create({
            data: {
              tenantId,
              productId: product.id,
              sku: vDto.sku,
              priceMinor: BigInt(vDto.priceMinor),
              costMinor: BigInt(vDto.costMinor || 0),
              reorderLevel: vDto.reorderLevel ?? dto.reorderLevel ?? 0,
              isActive: vDto.isActive ?? true,
            },
          });

          // Link option values if present
          if (vDto.optionValues) {
            for (const [optName, valName] of Object.entries(vDto.optionValues)) {
              const optDef = createdOptions.find((o) => o.name === optName);
              const valDef = optDef?.values.find((v: any) => v.value === valName);
              if (optDef && valDef) {
                await tx.variantOptionValue.create({
                  data: {
                    tenantId,
                    variantId: variant.id,
                    optionId: optDef.id,
                    optionValueId: valDef.id,
                  },
                });
              }
            }
          }

          // Link barcode if present
          if (vDto.barcode && vDto.barcode.trim()) {
            await tx.variantBarcode.create({
              data: {
                tenantId,
                variantId: variant.id,
                barcode: vDto.barcode.trim(),
              },
            });
          }

          createdVariants.push(variant);
        }
      } else if (combinations.length === 0) {
        // Default single variant
        const defaultVariant = await tx.productVariant.create({
          data: {
            tenantId,
            productId: product.id,
            sku: dto.sku,
            priceMinor: BigInt(dto.priceMinor),
            costMinor: BigInt(dto.costMinor || 0),
            reorderLevel: dto.reorderLevel || 0,
            isActive: true,
          },
        });
        createdVariants.push(defaultVariant);
      } else {
        // Cartesian variants
        for (const comb of combinations) {
          const skuSuffix = comb.map((s) => s.toUpperCase().replace(/\s+/g, "")).join("-");
          const variantSku = `${dto.sku}-${skuSuffix}`;

          const variant = await tx.productVariant.create({
            data: {
              tenantId,
              productId: product.id,
              sku: variantSku,
              priceMinor: BigInt(dto.priceMinor),
              costMinor: BigInt(dto.costMinor || 0),
              reorderLevel: dto.reorderLevel || 0,
              isActive: true,
            },
          });

          // Link variant option values
          for (let k = 0; k < comb.length; k++) {
            const optValName = comb[k];
            const optDef = createdOptions[k];
            const valDef = optDef.values.find((v: any) => v.value === optValName);

            if (valDef) {
              await tx.variantOptionValue.create({
                data: {
                  tenantId,
                  variantId: variant.id,
                  optionId: optDef.id,
                  optionValueId: valDef.id,
                },
              });
            }
          }

          createdVariants.push(variant);
        }
      }

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "product.create",
        entityType: "Product",
        entityId: product.id,
        after: { id: product.id, name: product.name, sku: dto.sku },
        ip,
      });

      return this.findOneInternal(tx, tenantId, product.id);
    });
  }

  /**
   * Helper to retrieve full product structure with options and variants.
   */
  private async findOneInternal(tx: any, tenantId: string, id: string) {
    return tx.product.findUnique({
      where: { id, tenantId },
      include: {
        category: true,
        brand: true,
        collection: true,
        taxClass: true,
        options: {
          include: { values: true },
          orderBy: { position: "asc" },
        },
        variants: {
          include: {
            optionValues: {
              include: {
                optionValue: {
                  include: {
                    option: true,
                  },
                },
              },
            },
            barcodes: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  /**
   * Finds all products with search, filters, whitelist sort, and pagination.
   */
  async findAll(
    tenantId: string,
    query: {
      search?: string;
      categoryId?: string;
      brandId?: string;
      collectionId?: string;
      branchId?: string;
      isActive?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const page = Math.max(Number(query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const skip = (page - 1) * limit;

      const where: any = { tenantId };

      if (query.isActive === "false" || query.isActive === (false as any)) {
        where.isActive = false;
      } else if (query.isActive === "all") {
        // no isActive constraint
      } else {
        where.isActive = true;
      }

      if (query.categoryId) where.categoryId = query.categoryId;
      if (query.brandId) where.brandId = query.brandId;
      if (query.collectionId) where.collectionId = query.collectionId;

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { variants: { some: { sku: { contains: query.search, mode: "insensitive" } } } },
          {
            variants: {
              some: {
                barcodes: {
                  some: { barcode: { contains: query.search, mode: "insensitive" } },
                },
              },
            },
          },
        ];
      }

      const allowedSortFields = ["name", "createdAt", "updatedAt"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const validBranchId =
        query.branchId && query.branchId !== "undefined" && query.branchId.trim().length > 0
          ? query.branchId
          : undefined;

      const [items, total] = await Promise.all([
        tx.product.findMany({
          where,
          include: {
            category: true,
            brand: true,
            collection: true,
            taxClass: true,
            variants: {
              include: {
                optionValues: {
                  include: {
                    optionValue: {
                      include: {
                        option: true,
                      },
                    },
                  },
                },
                barcodes: true,
                stockLevels: validBranchId ? { where: { branchId: validBranchId } } : true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
        }),
        tx.product.count({ where }),
      ]);

      const enrichedItems = items.map((p) => {
        let productTotalStock = 0;
        const variantsWithStock = p.variants.map((v) => {
          const vStock = (v.stockLevels || []).reduce(
            (sum, sl) => sum + Number(sl.qty || 0),
            0,
          );
          productTotalStock += vStock;
          return {
            ...v,
            totalStock: vStock,
          };
        });
        return {
          ...p,
          totalStock: productTotalStock,
          variants: variantsWithStock,
        };
      });

      return {
        items: enrichedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  /**
   * Finds a single product by ID.
   */
  async findOne(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const product = await this.findOneInternal(tx, tenantId, id);
      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }
      return product;
    });
  }

  /**
   * Updates product metadata.
   */
  async update(tenantId: string, id: string, dto: UpdateProductDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException(`Product not found`);

      const updated = await tx.product.update({
        where: { id, tenantId },
        data: {
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          brandId: dto.brandId,
          collectionId: dto.collectionId,
          taxClassId: dto.taxClassId,
          isActive: dto.isActive,
          customFields: dto.customFields as any,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "product.update",
        entityType: "Product",
        entityId: id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name: updated.name, isActive: updated.isActive },
        ip,
      });

      return this.findOneInternal(tx, tenantId, id);
    });
  }

  /**
   * Bulk updates variant prices with before/after audit trail.
   */
  async bulkUpdatePrices(
    tenantId: string,
    productId: string,
    dto: BulkPriceUpdateDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const results: any[] = [];

      for (const item of dto.variants) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId, tenantId },
        });

        if (!variant || variant.productId !== productId) {
          throw new NotFoundException(`Variant ${item.variantId} not found for product`);
        }

        const oldPrice = variant.priceMinor;
        const newPrice = BigInt(item.priceMinor);

        const updated = await tx.productVariant.update({
          where: { id: variant.id, tenantId },
          data: { priceMinor: newPrice },
        });

        await this.auditService.log(tx, {
          tenantId,
          actorUserId: userId,
          action: "variant.price_update",
          entityType: "ProductVariant",
          entityId: variant.id,
          before: { priceMinor: Number(oldPrice) },
          after: { priceMinor: Number(newPrice) },
          ip,
        });

        results.push(updated);
      }

      return results;
    });
  }
}
