import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateBrandDto,
  UpdateBrandDto,
  CreateCollectionDto,
  UpdateCollectionDto,
  CreateTaxClassDto,
  UpdateTaxClassDto,
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
      const existing = await tx.category.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Category with name '${dto.name}' already exists`);
      }

      if (dto.parentId) {
        const parent = await tx.category.findUnique({
          where: { id: dto.parentId },
        });
        if (!parent || parent.tenantId !== tenantId) {
          throw new UnprocessableEntityException("Parent category does not exist in this tenant");
        }
      }

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

  async findCategoryById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const category = await tx.category.findUnique({
        where: { id },
        include: { children: true, parent: true },
      });
      if (!category || category.tenantId !== tenantId) {
        throw new NotFoundException("Category not found");
      }
      return category;
    });
  }

  async updateCategory(
    tenantId: string,
    id: string,
    dto: UpdateCategoryDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.category.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Category not found");
      }

      if (dto.name && dto.name !== existing.name) {
        const duplicate = await tx.category.findFirst({
          where: { tenantId, name: dto.name, id: { not: id } },
        });
        if (duplicate) {
          throw new ConflictException(`Category with name '${dto.name}' already exists`);
        }
      }

      const targetParentId =
        dto.parentCategoryId !== undefined ? dto.parentCategoryId : dto.parentId;

      if (targetParentId !== undefined) {
        if (targetParentId === id) {
          throw new UnprocessableEntityException("Category cannot be its own parent");
        }
        if (targetParentId !== null) {
          const parent = await tx.category.findUnique({
            where: { id: targetParentId },
          });
          if (!parent || parent.tenantId !== tenantId) {
            throw new UnprocessableEntityException("Parent category does not exist in this tenant");
          }

          let curr: string | null = parent.parentId;
          while (curr) {
            if (curr === id) {
              throw new UnprocessableEntityException("Cannot set descendant category as parent");
            }
            const nextParent = await tx.category.findUnique({ where: { id: curr } });
            curr = nextParent?.parentId ?? null;
          }
        }
      }

      const updated = await tx.category.update({
        where: { id },
        data: {
          name: dto.name,
          parentId: targetParentId !== undefined ? targetParentId : undefined,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "category.update",
        entityType: "Category",
        entityId: id,
        before: existing,
        after: updated,
        ip,
      });

      return updated;
    });
  }

  // --- Brands ---
  async createBrand(tenantId: string, dto: CreateBrandDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.brand.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Brand with name '${dto.name}' already exists`);
      }

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

  async findBrandById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id } });
      if (!brand || brand.tenantId !== tenantId) {
        throw new NotFoundException("Brand not found");
      }
      return brand;
    });
  }

  async updateBrand(
    tenantId: string,
    id: string,
    dto: UpdateBrandDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.brand.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Brand not found");
      }

      if (dto.name && dto.name !== existing.name) {
        const duplicate = await tx.brand.findFirst({
          where: { tenantId, name: dto.name, id: { not: id } },
        });
        if (duplicate) {
          throw new ConflictException(`Brand with name '${dto.name}' already exists`);
        }
      }

      const updated = await tx.brand.update({
        where: { id },
        data: {
          name: dto.name,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "brand.update",
        entityType: "Brand",
        entityId: id,
        before: existing,
        after: updated,
        ip,
      });

      return updated;
    });
  }

  // --- Collections ---
  async createCollection(tenantId: string, dto: CreateCollectionDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.collection.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Collection with name '${dto.name}' already exists`);
      }

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

  async findCollectionById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const collection = await tx.collection.findUnique({ where: { id } });
      if (!collection || collection.tenantId !== tenantId) {
        throw new NotFoundException("Collection not found");
      }
      return collection;
    });
  }

  async updateCollection(
    tenantId: string,
    id: string,
    dto: UpdateCollectionDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.collection.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Collection not found");
      }

      if (dto.name && dto.name !== existing.name) {
        const duplicate = await tx.collection.findFirst({
          where: { tenantId, name: dto.name, id: { not: id } },
        });
        if (duplicate) {
          throw new ConflictException(`Collection with name '${dto.name}' already exists`);
        }
      }

      const updated = await tx.collection.update({
        where: { id },
        data: {
          name: dto.name,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "collection.update",
        entityType: "Collection",
        entityId: id,
        before: existing,
        after: updated,
        ip,
      });

      return updated;
    });
  }

  // --- Tax Classes ---
  async createTaxClass(tenantId: string, dto: CreateTaxClassDto, userId?: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.taxClass.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Tax class with name '${dto.name}' already exists`);
      }

      if (dto.isDefault) {
        await tx.taxClass.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

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

  async findTaxClassById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const taxClass = await tx.taxClass.findUnique({ where: { id } });
      if (!taxClass || taxClass.tenantId !== tenantId) {
        throw new NotFoundException("Tax class not found");
      }
      return taxClass;
    });
  }

  async updateTaxClass(
    tenantId: string,
    id: string,
    dto: UpdateTaxClassDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.taxClass.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Tax class not found");
      }

      if (dto.name && dto.name !== existing.name) {
        const duplicate = await tx.taxClass.findFirst({
          where: { tenantId, name: dto.name, id: { not: id } },
        });
        if (duplicate) {
          throw new ConflictException(`Tax class with name '${dto.name}' already exists`);
        }
      }

      if (dto.isActive === false && existing.isDefault) {
        throw new ConflictException("Cannot deactivate default tax class");
      }

      if (existing.isDefault && dto.isDefault === false) {
        throw new ConflictException("Cannot unset default tax class without designating another default");
      }

      if (dto.isDefault === true && !existing.isDefault) {
        await tx.taxClass.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.taxClass.update({
        where: { id },
        data: {
          name: dto.name,
          rateBp: dto.rateBp,
          isDefault: dto.isDefault,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(tx, {
        tenantId,
        actorUserId: userId,
        action: "tax_class.update",
        entityType: "TaxClass",
        entityId: id,
        before: existing,
        after: updated,
        ip,
      });

      return updated;
    });
  }
}
