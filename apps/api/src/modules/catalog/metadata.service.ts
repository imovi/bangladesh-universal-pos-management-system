import { Injectable } from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateCategoryDto,
  CreateBrandDto,
  CreateCollectionDto,
  CreateTaxClassDto,
} from "@universal-pos/shared";

@Injectable()
export class CatalogMetadataService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  // --- Categories ---
  async createCategory(tenantId: string, dto: CreateCategoryDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const category = await tx.category.create({
        data: {
          tenantId,
          name: dto.name,
          parentId: dto.parentId || null,
        },
      });
      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "category.create",
        entityType: "Category",
        entityId: category.id,
        after: category,
        ip,
      });
      return category;
    });
  }

  async findCategories(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.category.findMany({
        where: { tenantId },
        include: { children: true },
        orderBy: { name: "asc" },
      });
    });
  }

  // --- Brands ---
  async createBrand(tenantId: string, dto: CreateBrandDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const brand = await tx.brand.create({
        data: { tenantId, name: dto.name },
      });
      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "brand.create",
        entityType: "Brand",
        entityId: brand.id,
        after: brand,
        ip,
      });
      return brand;
    });
  }

  async findBrands(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.brand.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
    });
  }

  // --- Collections ---
  async createCollection(tenantId: string, dto: CreateCollectionDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const collection = await tx.collection.create({
        data: { tenantId, name: dto.name },
      });
      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "collection.create",
        entityType: "Collection",
        entityId: collection.id,
        after: collection,
        ip,
      });
      return collection;
    });
  }

  async findCollections(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.collection.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
    });
  }

  // --- Tax Classes ---
  async createTaxClass(tenantId: string, dto: CreateTaxClassDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const taxClass = await tx.taxClass.create({
        data: {
          tenantId,
          name: dto.name,
          rateBp: dto.rateBp,
          isDefault: dto.isDefault || false,
        },
      });
      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "tax_class.create",
        entityType: "TaxClass",
        entityId: taxClass.id,
        after: taxClass,
        ip,
      });
      return taxClass;
    });
  }

  async findTaxClasses(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.taxClass.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
    });
  }
}
