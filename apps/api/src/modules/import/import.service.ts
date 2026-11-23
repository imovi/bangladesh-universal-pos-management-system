import { Injectable, BadRequestException } from "@nestjs/common";
import crypto from "crypto";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  parseCsv,
  parsePoisha,
  normalizeBdPhone,
} from "./csv-parser.js";
import { Decimal } from "@prisma/client/runtime/library";

export type ImportType = "products" | "stock" | "customers";

export interface ImportError {
  field: string;
  messageBn: string;
  messageEn: string;
}

export interface ImportRowResult {
  rowNumber: number;
  status: "OK" | "ERROR";
  action?: "CREATE" | "UPDATE" | "SKIP";
  errors: ImportError[];
  data: Record<string, any>;
}

export interface ImportPreviewResult {
  type: ImportType;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportRowResult[];
}

export interface ImportCommitResult {
  success: boolean;
  type: ImportType;
  importedCount: number;
  message: string;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService
  ) {}

  /**
   * Returns CSV template with UTF-8 BOM and 3 sample rows in Bangla.
   */
  getTemplate(type: ImportType): string {
    const BOM = "\uFEFF";
    switch (type) {
      case "products":
        return (
          BOM +
          "product_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate\r\n" +
          "মেনস প্রিমিয়াম পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ কালেকশন ২০২৬,L,সাদা,PUN-001,890123456701,2500,1600,7.5\r\n" +
          "মেনস প্রিমিয়াম পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ কালেকশন ২০২৬,XL,সাদা,PUN-002,890123456702,2600,1650,7.5\r\n" +
          "উইমেনস জামদানি শাড়ি,শাড়ি,ঐতিহ্য,উৎসব কালেকশন,Free,লাল,SAR-001,890123456703,8500,5500,7.5\r\n"
        );
      case "stock":
        return (
          BOM +
          "sku,branch_code,quantity,unit_cost\r\n" +
          "PUN-001,MAIN,50,1600\r\n" +
          "PUN-002,MAIN,30,1650\r\n" +
          "SAR-001,MAIN,20,5500\r\n"
        );
      case "customers":
        return (
          BOM +
          "name,phone,opening_due,opening_loyalty_points\r\n" +
          "মোহাম্মদ রহিম,01711000001,1500,50\r\n" +
          "করিম উদ্দিন,01811000002,0,100\r\n" +
          "ফাতেমা আক্তার,01911000003,3200,200\r\n"
        );
      default:
        throw new BadRequestException(`Unknown template type: ${type}`);
    }
  }

  /**
   * Previews CSV import rows, checking syntax, business constraints, duplicate prevention, and formatting.
   */
  async preview(
    tenantId: string,
    type: ImportType,
    csvText: string
  ): Promise<ImportPreviewResult> {
    const { rows } = parseCsv(csvText);

    if (rows.length === 0) {
      throw new BadRequestException("CSV file is empty or contains no data rows");
    }

    if (rows.length > 20000) {
      throw new BadRequestException(
        "ফাইলের আকার সর্বোচ্চ ২০,০০০ লাইনের বেশি হতে পারবে না (File exceeds maximum limit of 20,000 rows)"
      );
    }

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      switch (type) {
        case "products":
          return this.previewProducts(tenantId, rows, tx);
        case "stock":
          return this.previewStock(tenantId, rows, tx);
        case "customers":
          return this.previewCustomers(tenantId, rows, tx);
        default:
          throw new BadRequestException(`Unknown import type: ${type}`);
      }
    });
  }

  /**
   * Commits validated CSV import rows inside a single database transaction.
   * Throws error if any row has an error.
   */
  async commit(
    tenantId: string,
    userId: string,
    type: ImportType,
    csvText: string
  ): Promise<ImportCommitResult> {
    const previewResult = await this.preview(tenantId, type, csvText);

    if (previewResult.errorRows > 0) {
      throw new BadRequestException(
        `আমদানি সম্পন্ন করা সম্ভব নয়: ফাইলে ${previewResult.errorRows}টি লাইনে ত্রুটি রয়েছে (Cannot commit import while errors exist)`
      );
    }

    return this.tenantContext.runWithTenant(
      tenantId,
      async (tx) => {
        let importedCount = 0;

        switch (type) {
          case "products":
            importedCount = await this.commitProducts(tenantId, previewResult.rows, tx);
            break;
          case "stock":
            importedCount = await this.commitStock(tenantId, userId, previewResult.rows, tx);
            break;
          case "customers":
            importedCount = await this.commitCustomers(tenantId, userId, previewResult.rows, tx);
            break;
        }

        // Record audit log
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: userId,
            action: "DATA_IMPORT",
            entityType: "IMPORT",
            entityId: type,
            after: {
              type,
              totalRows: previewResult.totalRows,
              importedCount,
              timestamp: new Date().toISOString(),
            },
          },
        });

        return {
          success: true,
          type,
          importedCount,
          message: `সফলভাবে ${importedCount}টি রেকর্ড আমদানি করা হয়েছে (Successfully imported ${importedCount} records)`,
        };
      },
      { maxWait: 20000, timeout: 90000 }
    );
  }

  // ==================== PRODUCTS IMPORT ====================

  private async previewProducts(
    tenantId: string,
    rawRows: Array<{ rowNumber: number; raw: Record<string, string> }>,
    tx: any
  ): Promise<ImportPreviewResult> {
    const existingVariants = await tx.productVariant.findMany({
      where: { tenantId },
      include: { barcodes: true },
    });
    const existingSkuMap = new Map<string, any>(
      existingVariants.map((v: any) => [v.sku.toLowerCase(), v])
    );
    const existingBarcodeMap = new Map<string, string>();
    for (const v of existingVariants) {
      for (const b of (v as any).barcodes) {
        existingBarcodeMap.set(b.barcode.toLowerCase(), v.sku);
      }
    }

    const fileSkus = new Set<string>();
    const fileBarcodes = new Set<string>();
    const results: ImportRowResult[] = [];
    let errorCount = 0;

    for (const row of rawRows) {
      const raw = row.raw;
      const errors: ImportError[] = [];

      const productName = (raw.productname || raw.product_name || raw.name || "").trim();
      const category = (raw.category || raw.categoryname || "").trim();
      const brand = (raw.brand || "").trim();
      const collection = (raw.collection || "").trim();
      const size = (raw.size || "").trim();
      const colour = (raw.colour || raw.color || "").trim();
      const sku = (raw.sku || "").trim();
      const barcode = (raw.barcode || "").trim();
      const rawSalePrice = raw.saleprice || raw.sale_price || raw.price || "";
      const rawCostPrice = raw.costprice || raw.cost_price || raw.cost || "0";
      const rawVatRate = raw.vatrate || raw.vat_rate || raw.vat || "0";

      if (!productName) {
        errors.push({ field: "product_name", messageBn: "পণ্যের নাম আবশ্যক", messageEn: "Product name is required" });
      }

      if (!category) {
        errors.push({ field: "category", messageBn: "ক্যাটাগরি আবশ্যক", messageEn: "Category is required" });
      }

      if (!sku) {
        errors.push({ field: "sku", messageBn: "এসকেইউ আবশ্যক", messageEn: "SKU is required" });
      } else {
        const skuKey = sku.toLowerCase();
        if (fileSkus.has(skuKey)) {
          errors.push({ field: "sku", messageBn: "একই এসকেইউ ফাইলে একাধিকবার এসেছে", messageEn: "Duplicate SKU within file" });
        }
        fileSkus.add(skuKey);
      }

      if (barcode) {
        const barcodeKey = barcode.toLowerCase();
        if (fileBarcodes.has(barcodeKey)) {
          errors.push({ field: "barcode", messageBn: "একই বারকোড ফাইলে একাধিকবার এসেছে", messageEn: "Duplicate barcode within file" });
        }
        fileBarcodes.add(barcodeKey);

        const existingSku = existingBarcodeMap.get(barcodeKey);
        if (existingSku && (!sku || existingSku.toLowerCase() !== sku.toLowerCase())) {
          errors.push({
            field: "barcode",
            messageBn: `বারকোডটি ইতিমধ্যে অন্য পণ্যে ব্যবহৃত হচ্ছে (SKU: ${existingSku})`,
            messageEn: `Barcode is already assigned to another variant (SKU: ${existingSku})`,
          });
        }
      }

      const salePriceMinor = parsePoisha(rawSalePrice);
      if (isNaN(salePriceMinor) || salePriceMinor < 0) {
        errors.push({ field: "sale_price", messageBn: "সঠিক বিক্রয় মূল্য দিন", messageEn: "Valid non-negative sale price is required" });
      }

      const costPriceMinor = parsePoisha(rawCostPrice);
      if (isNaN(costPriceMinor) || costPriceMinor < 0) {
        errors.push({ field: "cost_price", messageBn: "সঠিক ক্রয় মূল্য দিন", messageEn: "Valid non-negative cost price is required" });
      }

      const vatRate = parseFloat(rawVatRate.replace(/[^0-9.]/g, ""));
      if (isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
        errors.push({ field: "vat_rate", messageBn: "সঠিক ভ্যাট হার দিন (০ থেকে ১০০)", messageEn: "Valid VAT rate between 0 and 100 is required" });
      }

      const isUpdate = existingSkuMap.has(sku.toLowerCase());
      if (errors.length > 0) errorCount++;

      results.push({
        rowNumber: row.rowNumber,
        status: errors.length > 0 ? "ERROR" : "OK",
        action: isUpdate ? "UPDATE" : "CREATE",
        errors,
        data: {
          productName,
          category,
          brand,
          collection,
          size,
          colour,
          sku,
          barcode,
          salePriceMinor: isNaN(salePriceMinor) ? 0 : salePriceMinor,
          costPriceMinor: isNaN(costPriceMinor) ? 0 : costPriceMinor,
          vatRate: isNaN(vatRate) ? 0 : vatRate,
        },
      });
    }

    return {
      type: "products",
      totalRows: rawRows.length,
      validRows: rawRows.length - errorCount,
      errorRows: errorCount,
      rows: results,
    };
  }

  private async commitProducts(tenantId: string, rows: ImportRowResult[], tx: any): Promise<number> {
    // Group rows by product name
    const productGroups = new Map<string, ImportRowResult[]>();
    for (const row of rows) {
      const pName = row.data.productName;
      if (!productGroups.has(pName)) {
        productGroups.set(pName, []);
      }
      productGroups.get(pName)!.push(row);
    }

    // Pre-load reference maps to minimize database roundtrips during bulk imports
    const existingCategories = await tx.category.findMany({ where: { tenantId } });
    const categoryMap = new Map<string, any>(existingCategories.map((c: any) => [c.name.toLowerCase(), c]));

    const existingBrands = await tx.brand.findMany({ where: { tenantId } });
    const brandMap = new Map<string, any>(existingBrands.map((b: any) => [b.name.toLowerCase(), b]));

    const existingCollections = await tx.collection.findMany({ where: { tenantId } });
    const collectionMap = new Map<string, any>(existingCollections.map((c: any) => [c.name.toLowerCase(), c]));

    const existingTaxClasses = await tx.taxClass.findMany({ where: { tenantId } });
    const taxClassMap = new Map<number, string>(existingTaxClasses.map((t: any) => [t.rateBp, t.id]));

    const existingProducts = await tx.product.findMany({
      where: { tenantId },
      include: {
        options: {
          include: { values: true },
        },
      },
    });
    const productMap = new Map<string, any>(existingProducts.map((p: any) => [p.name.toLowerCase(), p]));

    const existingVariants = await tx.productVariant.findMany({
      where: { tenantId },
      include: {
        barcodes: true,
        optionValues: true,
      },
    });
    const variantMap = new Map<string, any>(existingVariants.map((v: any) => [v.sku.toLowerCase(), v]));

    // Step 1: Pre-resolve/create missing Categories, Brands, Collections, TaxClasses
    for (const [, variantRows] of productGroups) {
      const firstRow = variantRows[0].data;

      const catKey = firstRow.category.toLowerCase();
      if (!categoryMap.has(catKey)) {
        const category = await tx.category.create({
          data: { tenantId, name: firstRow.category },
        });
        categoryMap.set(catKey, category);
      }

      if (firstRow.brand) {
        const brandKey = firstRow.brand.toLowerCase();
        if (!brandMap.has(brandKey)) {
          const brand = await tx.brand.create({
            data: { tenantId, name: firstRow.brand },
          });
          brandMap.set(brandKey, brand);
        }
      }

      if (firstRow.collection) {
        const collKey = firstRow.collection.toLowerCase();
        if (!collectionMap.has(collKey)) {
          const collection = await tx.collection.create({
            data: { tenantId, name: firstRow.collection },
          });
          collectionMap.set(collKey, collection);
        }
      }

      if (firstRow.vatRate > 0) {
        const rateBp = Math.round(firstRow.vatRate * 100);
        if (!taxClassMap.has(rateBp)) {
          const tc = await tx.taxClass.create({
            data: {
              tenantId,
              name: `VAT ${firstRow.vatRate}%`,
              rateBp,
            },
          });
          taxClassMap.set(rateBp, tc.id);
        }
      }
    }

    // Step 2: Batch insert missing Products
    const productsToCreate: any[] = [];
    for (const [productName, variantRows] of productGroups) {
      const pKey = productName.toLowerCase();
      let product = productMap.get(pKey);
      if (!product) {
        const firstRow = variantRows[0].data;
        const category = categoryMap.get(firstRow.category.toLowerCase());
        const brandId = firstRow.brand ? brandMap.get(firstRow.brand.toLowerCase())?.id : null;
        const collectionId = firstRow.collection ? collectionMap.get(firstRow.collection.toLowerCase())?.id : null;
        const rateBp = firstRow.vatRate > 0 ? Math.round(firstRow.vatRate * 100) : null;
        const taxClassId = rateBp ? taxClassMap.get(rateBp) : null;

        const newProductId = crypto.randomUUID();
        product = {
          id: newProductId,
          tenantId,
          categoryId: category?.id,
          brandId,
          collectionId,
          taxClassId,
          name: productName,
          isActive: true,
          options: [],
        };
        const now = new Date();
        productsToCreate.push({
          id: newProductId,
          tenantId,
          categoryId: category?.id,
          brandId,
          collectionId,
          taxClassId,
          name: productName,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        productMap.set(pKey, product);
      }
    }

    if (productsToCreate.length > 0) {
      for (const chunk of chunkArray(productsToCreate, 500)) {
        await tx.product.createMany({ data: chunk });
      }
    }

    // Step 3: Batch insert missing ProductOptions (Size & Colour)
    const optionsToCreate: any[] = [];
    for (const [productName, variantRows] of productGroups) {
      const product = productMap.get(productName.toLowerCase());
      const hasSize = variantRows.some((r) => r.data.size);
      let sizeOption = product.options?.find((o: any) => o.name === "Size");
      if (hasSize && !sizeOption) {
        const sizeOptionId = crypto.randomUUID();
        sizeOption = {
          id: sizeOptionId,
          tenantId,
          productId: product.id,
          name: "Size",
          position: 0,
          values: [],
        };
        if (!product.options) product.options = [];
        product.options.push(sizeOption);
        optionsToCreate.push({
          id: sizeOptionId,
          tenantId,
          productId: product.id,
          name: "Size",
          position: 0,
        });
      }

      const hasColour = variantRows.some((r) => r.data.colour);
      let colourOption = product.options?.find((o: any) => o.name === "Colour");
      if (hasColour && !colourOption) {
        const colourOptionId = crypto.randomUUID();
        colourOption = {
          id: colourOptionId,
          tenantId,
          productId: product.id,
          name: "Colour",
          position: 1,
          values: [],
        };
        if (!product.options) product.options = [];
        product.options.push(colourOption);
        optionsToCreate.push({
          id: colourOptionId,
          tenantId,
          productId: product.id,
          name: "Colour",
          position: 1,
        });
      }
    }

    if (optionsToCreate.length > 0) {
      for (const chunk of chunkArray(optionsToCreate, 500)) {
        await tx.productOption.createMany({ data: chunk });
      }
    }

    // Step 4: Batch insert missing ProductOptionValues
    const optionValuesToCreate: any[] = [];
    const optionValueMaps = new Map<string, string>(); // `${optionId}:${value.toLowerCase()}` -> id

    // Populate existing values
    for (const [, product] of productMap) {
      if (product.options) {
        for (const opt of product.options) {
          if (opt.values) {
            for (const v of opt.values) {
              optionValueMaps.set(`${opt.id}:${v.value.toLowerCase()}`, v.id);
            }
          }
        }
      }
    }

    for (const [productName, variantRows] of productGroups) {
      const product = productMap.get(productName.toLowerCase());
      const sizeOption = product.options?.find((o: any) => o.name === "Size");
      const colourOption = product.options?.find((o: any) => o.name === "Colour");

      for (const row of variantRows) {
        const vData = row.data;
        if (sizeOption && vData.size) {
          const sKey = `${sizeOption.id}:${vData.size.toLowerCase()}`;
          if (!optionValueMaps.has(sKey)) {
            const valId = crypto.randomUUID();
            optionValueMaps.set(sKey, valId);
            optionValuesToCreate.push({
              id: valId,
              tenantId,
              optionId: sizeOption.id,
              value: vData.size,
              position: 0,
            });
          }
        }

        if (colourOption && vData.colour) {
          const cKey = `${colourOption.id}:${vData.colour.toLowerCase()}`;
          if (!optionValueMaps.has(cKey)) {
            const valId = crypto.randomUUID();
            optionValueMaps.set(cKey, valId);
            optionValuesToCreate.push({
              id: valId,
              tenantId,
              optionId: colourOption.id,
              value: vData.colour,
              position: 0,
            });
          }
        }
      }
    }

    if (optionValuesToCreate.length > 0) {
      for (const chunk of chunkArray(optionValuesToCreate, 500)) {
        await tx.productOptionValue.createMany({ data: chunk });
      }
    }

    // Step 5: Process Variants (Batch insert new variants, update existing)
    const newVariants: any[] = [];
    const newBarcodes: any[] = [];
    const newOptionLinks: any[] = [];
    const existingVariantUpdates: any[] = [];

    for (const [productName, variantRows] of productGroups) {
      const product = productMap.get(productName.toLowerCase());
      const sizeOption = product.options?.find((o: any) => o.name === "Size");
      const colourOption = product.options?.find((o: any) => o.name === "Colour");

      for (const row of variantRows) {
        const vData = row.data;
        const skuKey = vData.sku.toLowerCase();

        let sizeValId: string | undefined;
        if (sizeOption && vData.size) {
          sizeValId = optionValueMaps.get(`${sizeOption.id}:${vData.size.toLowerCase()}`);
        }

        let colValId: string | undefined;
        if (colourOption && vData.colour) {
          colValId = optionValueMaps.get(`${colourOption.id}:${vData.colour.toLowerCase()}`);
        }

        const existingVariant = variantMap.get(skuKey);
        if (existingVariant) {
          existingVariantUpdates.push({
            id: existingVariant.id,
            priceMinor: BigInt(vData.salePriceMinor),
            costMinor: BigInt(vData.costPriceMinor),
            variant: existingVariant,
            sizeOption,
            sizeValId,
            colourOption,
            colValId,
            barcode: vData.barcode,
          });
        } else {
          const variantId = crypto.randomUUID();
          const now = new Date();
          newVariants.push({
            id: variantId,
            tenantId,
            productId: product.id,
            sku: vData.sku,
            priceMinor: BigInt(vData.salePriceMinor),
            costMinor: BigInt(vData.costPriceMinor),
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });

          if (vData.barcode) {
            newBarcodes.push({
              id: crypto.randomUUID(),
              tenantId,
              variantId,
              barcode: vData.barcode,
            });
          }

          if (sizeValId && sizeOption) {
            newOptionLinks.push({
              id: crypto.randomUUID(),
              tenantId,
              variantId,
              optionId: sizeOption.id,
              optionValueId: sizeValId,
            });
          }

          if (colValId && colourOption) {
            newOptionLinks.push({
              id: crypto.randomUUID(),
              tenantId,
              variantId,
              optionId: colourOption.id,
              optionValueId: colValId,
            });
          }
        }
      }
    }

    // Batch insert new variants, barcodes, and option links in chunks of 500
    if (newVariants.length > 0) {
      for (const chunk of chunkArray(newVariants, 500)) {
        await tx.productVariant.createMany({ data: chunk });
      }
    }

    if (newBarcodes.length > 0) {
      for (const chunk of chunkArray(newBarcodes, 500)) {
        await tx.variantBarcode.createMany({ data: chunk });
      }
    }

    if (newOptionLinks.length > 0) {
      for (const chunk of chunkArray(newOptionLinks, 500)) {
        await tx.variantOptionValue.createMany({ data: chunk });
      }
    }

    // Process updates for existing variants
    for (const upd of existingVariantUpdates) {
      await tx.productVariant.update({
        where: { id: upd.id },
        data: {
          priceMinor: upd.priceMinor,
          costMinor: upd.costMinor,
          isActive: true,
          updatedAt: new Date(),
        },
      });

      if (upd.sizeValId && upd.sizeOption) {
        const hasLink = upd.variant.optionValues?.some((ov: any) => ov.optionId === upd.sizeOption.id);
        if (!hasLink) {
          await tx.variantOptionValue.create({
            data: {
              tenantId,
              variantId: upd.id,
              optionId: upd.sizeOption.id,
              optionValueId: upd.sizeValId,
            },
          });
        }
      }

      if (upd.colValId && upd.colourOption) {
        const hasColLink = upd.variant.optionValues?.some((ov: any) => ov.optionId === upd.colourOption.id);
        if (!hasColLink) {
          await tx.variantOptionValue.create({
            data: {
              tenantId,
              variantId: upd.id,
              optionId: upd.colourOption.id,
              optionValueId: upd.colValId,
            },
          });
        }
      }

      if (upd.barcode) {
        const hasBc = upd.variant.barcodes?.some((b: any) => b.barcode.toLowerCase() === upd.barcode.toLowerCase());
        if (!hasBc) {
          await tx.variantBarcode.create({
            data: { tenantId, variantId: upd.id, barcode: upd.barcode },
          });
        }
      }
    }

    // Ensure all touched products have their updatedAt bumped for catalog delta sync
    const touchedProductIds = new Set<string>();
    for (const p of productsToCreate) touchedProductIds.add(p.id);
    for (const [, rows] of productGroups) {
      const p = productMap.get(rows[0].data.productName?.toLowerCase());
      if (p?.id) touchedProductIds.add(p.id);
    }
    if (touchedProductIds.size > 0) {
      await tx.product.updateMany({
        where: { id: { in: Array.from(touchedProductIds) }, tenantId },
        data: { updatedAt: new Date() },
      });
    }

    return newVariants.length + existingVariantUpdates.length;
  }

  // ==================== OPENING STOCK IMPORT ====================

  private async previewStock(tenantId: string, rawRows: any[], tx: any): Promise<ImportPreviewResult> {
    const branches = await tx.branch.findMany({
      where: { tenantId },
      select: { id: true, code: true },
    });
    const branchMap = new Map<string, string>(branches.map((b: any) => [b.code.toLowerCase(), b.id]));

    const variants = await tx.productVariant.findMany({
      where: { tenantId },
      include: { barcodes: true },
    });
    const variantSkuMap = new Map<string, any>(variants.map((v: any) => [v.sku.toLowerCase(), v]));
    const barcodeMap = new Map<string, any>();
    for (const v of variants) {
      for (const b of (v as any).barcodes) {
        barcodeMap.set(b.barcode.toLowerCase(), v);
      }
    }

    // Query existing opening stock movements
    const existingOpeningMovements = await tx.stockMovement.findMany({
      where: { tenantId, type: "OPENING" },
      select: { branchId: true, variantId: true },
    });
    const openingStockRecorded = new Set(
      existingOpeningMovements.map((m: any) => `${m.branchId}:${m.variantId}`)
    );

    const filePairs = new Set<string>();
    const results: ImportRowResult[] = [];
    let errorCount = 0;

    for (const row of rawRows) {
      const raw = row.raw;
      const errors: ImportError[] = [];

      const skuOrBarcode = (raw.sku || raw.barcode || "").trim();
      const branchCode = (raw.branchcode || raw.branch_code || raw.branch || "").trim();
      const rawQty = raw.quantity || raw.qty || "";
      const rawCost = raw.unitcost || raw.unit_cost || raw.cost || "";

      if (!skuOrBarcode) {
        errors.push({ field: "sku", messageBn: "এসকেইউ বা বারকোড আবশ্যক", messageEn: "SKU or barcode is required" });
      }

      let variant = variantSkuMap.get(skuOrBarcode.toLowerCase());
      if (!variant) {
        variant = barcodeMap.get(skuOrBarcode.toLowerCase());
      }
      if (!variant) {
        errors.push({
          field: "sku",
          messageBn: `পণ্য পাওয়া যায়নি: ${skuOrBarcode}`,
          messageEn: `Product variant not found: ${skuOrBarcode}`,
        });
      }

      if (!branchCode) {
        errors.push({ field: "branch_code", messageBn: "শাখা কোড আবশ্যক", messageEn: "Branch code is required" });
      }
      const branchId = branchMap.get(branchCode.toLowerCase());
      if (!branchId) {
        errors.push({
          field: "branch_code",
          messageBn: `শাখা পাওয়া যায়নি: ${branchCode}`,
          messageEn: `Branch code not found: ${branchCode}`,
        });
      }

      const qty = parseFloat(rawQty);
      if (isNaN(qty) || qty <= 0) {
        errors.push({ field: "quantity", messageBn: "সঠিক ধনাত্মক স্টক পরিমাণ দিন", messageEn: "Valid positive quantity is required" });
      }

      const unitCostMinor = parsePoisha(rawCost);
      if (isNaN(unitCostMinor) || unitCostMinor < 0) {
        errors.push({ field: "unit_cost", messageBn: "সঠিক ক্রয় মূল্য দিন", messageEn: "Valid unit cost is required" });
      }

      // Safe to repeat check: refuse second import for same SKU and branch
      if (variant && branchId) {
        const pairKey = `${branchId}:${variant.id}`;
        if (filePairs.has(pairKey)) {
          errors.push({
            field: "sku",
            messageBn: "একই শাখা ও পণ্যের মজুদ ফাইলে একাধিকবার এসেছে",
            messageEn: "Duplicate SKU and branch combination within file",
          });
        }
        filePairs.add(pairKey);

        if (openingStockRecorded.has(pairKey)) {
          errors.push({
            field: "sku",
            messageBn: "এই শাখা ও এসকেইউ-এর জন্য প্রারম্ভিক মজুদ ইতিপূর্বে যুক্ত করা হয়েছে",
            messageEn: "Opening stock has already been recorded for this SKU and branch",
          });
        }
      }

      if (errors.length > 0) errorCount++;

      results.push({
        rowNumber: row.rowNumber,
        status: errors.length > 0 ? "ERROR" : "OK",
        errors,
        data: {
          sku: skuOrBarcode,
          branchCode,
          branchId,
          variantId: variant?.id,
          quantity: isNaN(qty) ? 0 : qty,
          unitCostMinor: isNaN(unitCostMinor) ? 0 : unitCostMinor,
        },
      });
    }

    return {
      type: "stock",
      totalRows: rawRows.length,
      validRows: rawRows.length - errorCount,
      errorRows: errorCount,
      rows: results,
    };
  }

  private async commitStock(tenantId: string, userId: string, rows: ImportRowResult[], tx: any): Promise<number> {
    const movementsToCreate: any[] = [];
    const stockLevelsToProcess: any[] = [];

    for (const row of rows) {
      const data = row.data;
      const qtyDecimal = new Decimal(data.quantity);

      movementsToCreate.push({
        id: crypto.randomUUID(),
        tenantId,
        branchId: data.branchId,
        variantId: data.variantId,
        qtyDelta: qtyDecimal,
        type: "OPENING",
        unitCostMinor: BigInt(data.unitCostMinor),
        actorUserId: userId,
        reason: "Initial CSV Opening Stock Import",
      });

      stockLevelsToProcess.push({
        tenantId,
        branchId: data.branchId,
        variantId: data.variantId,
        qty: qtyDecimal,
      });
    }

    // Batch insert movements in chunks of 500
    for (const chunk of chunkArray(movementsToCreate, 500)) {
      await tx.stockMovement.createMany({ data: chunk });
    }

    // Upsert StockLevels
    const now = new Date();
    for (const sl of stockLevelsToProcess) {
      await tx.stockLevel.upsert({
        where: {
          tenantId_branchId_variantId: {
            tenantId: sl.tenantId,
            branchId: sl.branchId,
            variantId: sl.variantId,
          },
        },
        create: {
          ...sl,
          updatedAt: now,
        },
        update: {
          qty: { increment: sl.qty },
          updatedAt: now,
        },
      });
    }

    // Touch updatedAt on affected variants and products so delta sync includes new stock
    const touchedVariantIds = Array.from(new Set(stockLevelsToProcess.map((sl) => sl.variantId)));
    if (touchedVariantIds.length > 0) {
      await tx.productVariant.updateMany({
        where: { id: { in: touchedVariantIds }, tenantId },
        data: { updatedAt: now },
      });
      const variantsWithProd = await tx.productVariant.findMany({
        where: { id: { in: touchedVariantIds }, tenantId },
        select: { productId: true },
      });
      const prodIds = Array.from(new Set(variantsWithProd.map((v: any) => v.productId)));
      if (prodIds.length > 0) {
        await tx.product.updateMany({
          where: { id: { in: prodIds }, tenantId },
          data: { updatedAt: now },
        });
      }
    }

    return movementsToCreate.length;
  }

  // ==================== CUSTOMERS IMPORT ====================

  private async previewCustomers(tenantId: string, rawRows: any[], tx: any): Promise<ImportPreviewResult> {
    const existingCustomers = await tx.customer.findMany({
      where: { tenantId },
      select: { phone: true },
    });
    const existingPhoneMap = new Set(existingCustomers.map((c: any) => c.phone));

    const filePhones = new Set<string>();
    const results: ImportRowResult[] = [];
    let errorCount = 0;

    for (const row of rawRows) {
      const raw = row.raw;
      const errors: ImportError[] = [];

      const name = (raw.name || raw.customername || raw.customer_name || "").trim();
      const rawPhone = (raw.phone || raw.mobile || "").trim();
      const rawDue = raw.openingdue || raw.opening_due || raw.due || "0";
      const rawPoints = raw.openingloyaltypoints || raw.opening_loyalty_points || raw.loyaltypoints || raw.points || "0";

      if (!name) {
        errors.push({ field: "name", messageBn: "গ্রাহকের নাম আবশ্যক", messageEn: "Customer name is required" });
      }

      const normalizedPhone = normalizeBdPhone(rawPhone);
      if (!normalizedPhone) {
        errors.push({
          field: "phone",
          messageBn: "সঠিক বাংলাদেশী মোবাইল নম্বর দিন (যেমন: 01711000000)",
          messageEn: "Valid Bangladeshi phone number is required (e.g. 01711000000)",
        });
      } else {
        if (filePhones.has(normalizedPhone)) {
          errors.push({
            field: "phone",
            messageBn: "একই ফোন নম্বর ফাইলে একাধিকবার এসেছে",
            messageEn: "Duplicate phone number within file",
          });
        }
        filePhones.add(normalizedPhone);
      }

      const openingDueMinor = parsePoisha(rawDue);
      if (isNaN(openingDueMinor) || openingDueMinor < 0) {
        errors.push({ field: "opening_due", messageBn: "সঠিক বকেয়া টাকার পরিমাণ দিন", messageEn: "Opening due cannot be negative" });
      }

      const openingPoints = parseInt(rawPoints, 10);
      if (isNaN(openingPoints) || openingPoints < 0) {
        errors.push({ field: "opening_points", messageBn: "সঠিক লয়্যালটি পয়েন্ট দিন", messageEn: "Opening points cannot be negative" });
      }

      const isExisting = normalizedPhone ? existingPhoneMap.has(normalizedPhone) : false;
      if (errors.length > 0) errorCount++;

      results.push({
        rowNumber: row.rowNumber,
        status: errors.length > 0 ? "ERROR" : "OK",
        action: isExisting ? "UPDATE" : "CREATE",
        errors,
        data: {
          name,
          phone: normalizedPhone || rawPhone,
          openingDueMinor: isNaN(openingDueMinor) ? 0 : openingDueMinor,
          openingPoints: isNaN(openingPoints) ? 0 : openingPoints,
        },
      });
    }

    return {
      type: "customers",
      totalRows: rawRows.length,
      validRows: rawRows.length - errorCount,
      errorRows: errorCount,
      rows: results,
    };
  }

  private async commitCustomers(tenantId: string, userId: string, rows: ImportRowResult[], tx: any): Promise<number> {
    let count = 0;
    let defaultBranch: any = null;
    let systemRegister: any = null;
    let openingShift: any = null;

    for (const row of rows) {
      const data = row.data;

      // Find or create customer by phone (safe to repeat)
      let customer = await tx.customer.findFirst({
        where: { tenantId, phone: data.phone },
      });

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            tenantId,
            name: data.name,
            phone: data.phone,
            loyaltyPointsBalance: data.openingPoints,
          },
        });
      } else {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: data.name,
            loyaltyPointsBalance: customer.loyaltyPointsBalance + data.openingPoints,
          },
        });
      }

      // Record loyalty points adjustment if opening points > 0
      if (data.openingPoints > 0) {
        await tx.loyaltyLedger.create({
          data: {
            tenantId,
            customerId: customer.id,
            type: "ADJUST",
            points: data.openingPoints,
            reason: "opening balance",
          },
        });
      }

      // Record opening due in customer ledger via an opening credit sale if opening due > 0
      if (data.openingDueMinor > 0) {
        const openingInv = `OPENING-${data.phone}`;
        const existingSale = await tx.sale.findFirst({
          where: { tenantId, invoiceNumber: openingInv },
        });

        if (!existingSale) {
          if (!defaultBranch) {
            defaultBranch = await tx.branch.findFirst({ where: { tenantId } });
          }
          if (defaultBranch) {
            if (!systemRegister) {
              systemRegister = await tx.register.findFirst({
                where: { tenantId, branchId: defaultBranch.id },
              });
              if (!systemRegister) {
                systemRegister = await tx.register.create({
                  data: {
                    tenantId,
                    branchId: defaultBranch.id,
                    name: "System Register",
                    code: "SYS-REG",
                  },
                });
              }
            }

            if (!openingShift) {
              openingShift = await tx.shift.findFirst({
                where: {
                  tenantId,
                  branchId: defaultBranch.id,
                  notes: "System Shift for Opening Balances",
                },
              });
              if (!openingShift) {
                openingShift = await tx.shift.create({
                  data: {
                    tenantId,
                    branchId: defaultBranch.id,
                    registerId: systemRegister.id,
                    cashierUserId: userId,
                    status: "closed",
                    openedAt: new Date(0),
                    closedAt: new Date(0),
                    openingCashMinor: 0n,
                    notes: "System Shift for Opening Balances",
                  },
                });
              }
            }

            await tx.sale.create({
              data: {
                tenantId,
                branchId: defaultBranch.id,
                shiftId: openingShift.id,
                cashierUserId: userId,
                customerId: customer.id,
                invoiceNumber: openingInv,
                status: "completed",
                subtotalMinor: BigInt(data.openingDueMinor),
                discountMinor: 0n,
                taxMinor: 0n,
                totalMinor: BigInt(data.openingDueMinor),
                paidMinor: 0n,
                dueMinor: BigInt(data.openingDueMinor),
                changeMinor: 0n,
                notes: "Opening balance import",
                occurredAt: new Date(),
              },
            });
          }
        }
      }

      count++;
    }

    return count;
  }
}
