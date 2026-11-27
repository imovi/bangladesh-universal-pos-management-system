import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { JwtService, JwtModule } from "@nestjs/jwt";
import { v7 as uuidv7 } from "uuid";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { ConfigService } from "../src/common/config/config.service.js";
import { ProductsService } from "../src/modules/catalog/products.service.js";
import { UnitsService } from "../src/modules/catalog/units.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { PurchaseOrdersService } from "../src/modules/purchasing/purchase-orders.service.js";
import { GoodsReceiptsService } from "../src/modules/purchasing/goods-receipts.service.js";
import { SuppliersService } from "../src/modules/purchasing/suppliers.service.js";
import { computeSalePayloadHash } from "../src/modules/sales/sales-hash.helper.js";
import {
  truncateTestDatabase,
  createTestPrismaClient,
  createTestAdminPrismaClient,
} from "./test-db-helper.js";
import { evaluatePromotions, PromotionRule } from "@universal-pos/shared";

describe("Phase 2.1 Units and POS Business Logic Tests", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminPrisma: PrismaClient;
  let configService: ConfigService;
  let jwtService: JwtService;
  let tenantsService: TenantsService;
  let productsService: ProductsService;
  let unitsService: UnitsService;
  let inventoryService: InventoryService;
  let poService: PurchaseOrdersService;
  let grService: GoodsReceiptsService;
  let suppliersService: SuppliersService;

  let chemicalTenant: any;
  let chemicalOwnerToken: string;
  let fashionTenant: any;
  let fashionOwnerToken: string;

  let chemicalRegisterId: string;
  let chemicalShiftId: string;

  // Products
  let hclProduct: any;
  let hclVariant: any;
  let hclCanUnit: any;
  let hclDrumUnit: any;

  let csProduct: any;
  let csVariant: any;
  let csBagUnit: any;

  let dwProduct: any;
  let dwVariant: any;
  let dwCartonUnit: any;

  let supplierId: string;

  async function getStock(tenantId: string, variantId: string, branchId: string): Promise<number> {
    const sl = await adminPrisma.stockLevel.findUnique({
      where: {
        tenantId_branchId_variantId: {
          tenantId,
          branchId,
          variantId,
        },
      },
    });
    return sl ? Number(sl.qty) : 0;
  }

  beforeAll(async () => {
    await truncateTestDatabase();
    prisma = createTestPrismaClient();
    adminPrisma = createTestAdminPrismaClient();
    await prisma.$connect();
    await adminPrisma.$connect();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule, JwtModule.register({})],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    configService = app.get(ConfigService);
    jwtService = app.get(JwtService);
    tenantsService = app.get(TenantsService);
    productsService = app.get(ProductsService);
    unitsService = app.get(UnitsService);
    inventoryService = app.get(InventoryService);
    poService = app.get(PurchaseOrdersService);
    grService = app.get(GoodsReceiptsService);
    suppliersService = app.get(SuppliersService);

    // 1. Setup Chemical Tenant (businessType: "chemical" enables "units" module)
    chemicalTenant = await tenantsService.signup({
      companyName: "Chemical Solutions Ltd",
      slug: "chemical-solutions-" + Date.now().toString(36),
      businessType: "chemical",
      owner: {
        name: "Chemical Owner",
        email: "owner@chemsol.com",
        phone: "+8801700000030",
        password: "Password123!",
      },
      branch: {
        name: "Chemical Depot",
        code: "CD-01",
      },
    });

    const accessSecret = configService.get("JWT_ACCESS_SECRET");
    chemicalOwnerToken = await jwtService.signAsync(
      {
        sub: chemicalTenant.ownerId,
        email: "owner@chemsol.com",
        tenantId: chemicalTenant.tenantId,
        roles: ["Owner"],
        permissions: [
          "tenant.read",
          "tenant.update",
          "sale.create",
          "sale.view",
          "sale.return",
          "sale.void",
          "catalog.create",
          "catalog.update",
          "inventory.view",
          "inventory.adjust",
          "purchasing.create",
          "purchasing.receive",
        ],
        isOwner: true,
      },
      { secret: accessSecret, expiresIn: "1h" },
    );

    // 2. Setup Fashion Tenant (businessType: "fashion" has units disabled)
    fashionTenant = await tenantsService.signup({
      companyName: "Fashion Outlet Ltd",
      slug: "fashion-outlet-" + Date.now().toString(36),
      businessType: "fashion",
      owner: {
        name: "Fashion Owner",
        email: "owner@fashionout.com",
        phone: "+8801700000031",
        password: "Password123!",
      },
      branch: {
        name: "Fashion Store",
        code: "FS-01",
      },
    });

    fashionOwnerToken = await jwtService.signAsync(
      {
        sub: fashionTenant.ownerId,
        email: "owner@fashionout.com",
        tenantId: fashionTenant.tenantId,
        roles: ["Owner"],
        permissions: ["tenant.read", "catalog.create", "sale.create", "inventory.view"],
        isOwner: true,
      },
      { secret: accessSecret, expiresIn: "1h" },
    );

    // 3. Register & Shift for Chemical Tenant
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .send({
        branchId: chemicalTenant.branchId,
        name: "Depot Register",
        code: "REG01",
      });
    chemicalRegisterId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .send({
        registerId: chemicalRegisterId,
        branchId: chemicalTenant.branchId,
        openingCashMinor: 50000,
      });
    chemicalShiftId = shiftRes.body.data.id;

    // 4. Products in Chemical Tenant:
    // HCl: baseUnit: "l", allowDecimalQty: true, price ৳45/l (4500)
    hclProduct = await productsService.create(
      chemicalTenant.tenantId,
      {
        name: "হাইড্রোক্লোরিক অ্যাসিড (HCl)",
        sku: "CHEM-HCL",
        baseUnit: "l",
        allowDecimalQty: true,
        priceMinor: 4500,
        costMinor: 3000,
      },
      chemicalTenant.ownerId,
    );
    hclVariant = hclProduct.variants[0];

    hclCanUnit = await unitsService.createUnit(
      chemicalTenant.tenantId,
      hclProduct.id,
      {
        name: "5 লিটার ক্যান",
        factor: 5,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
      chemicalTenant.ownerId,
    );

    hclDrumUnit = await unitsService.createUnit(
      chemicalTenant.tenantId,
      hclProduct.id,
      {
        name: "ড্রাম",
        factor: 200,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
      chemicalTenant.ownerId,
    );

    await unitsService.setVariantUnitPrice(
      chemicalTenant.tenantId,
      hclVariant.id,
      hclDrumUnit.id,
      {
        priceMinor: 850000, // ৳8,500 override
      },
      chemicalTenant.ownerId,
    );

    // Caustic soda: baseUnit: "kg", allowDecimalQty: true, price ৳120/kg (12000)
    csProduct = await productsService.create(
      chemicalTenant.tenantId,
      {
        name: "কস্টিক সোডা",
        sku: "CHEM-CS",
        baseUnit: "kg",
        allowDecimalQty: true,
        priceMinor: 12000,
        costMinor: 9000,
      },
      chemicalTenant.ownerId,
    );
    csVariant = csProduct.variants[0];

    csBagUnit = await unitsService.createUnit(
      chemicalTenant.tenantId,
      csProduct.id,
      {
        name: "বস্তা",
        factor: 25,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
      chemicalTenant.ownerId,
    );

    // Distilled water: baseUnit: "l", allowDecimalQty: false, price ৳30/l (3000)
    dwProduct = await productsService.create(
      chemicalTenant.tenantId,
      {
        name: "ডিস্টিলড ওয়াটার",
        sku: "CHEM-DW",
        baseUnit: "l",
        allowDecimalQty: false,
        priceMinor: 3000,
        costMinor: 2000,
      },
      chemicalTenant.ownerId,
    );
    dwVariant = dwProduct.variants[0];

    dwCartonUnit = await unitsService.createUnit(
      chemicalTenant.tenantId,
      dwProduct.id,
      {
        name: "কার্টন",
        factor: 12,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
      chemicalTenant.ownerId,
    );

    // Initial stock in Tejgaon depot: 1000 l HCl, 500 kg CS, 240 l DW
    await inventoryService.createOpeningStock(
      chemicalTenant.tenantId,
      {
        branchId: chemicalTenant.branchId,
        items: [
          { variantId: hclVariant.id, quantity: 1000, unitCostMinor: 3000 },
          { variantId: csVariant.id, quantity: 500, unitCostMinor: 9000 },
          { variantId: dwVariant.id, quantity: 240, unitCostMinor: 2000 },
        ],
      },
      chemicalTenant.ownerId,
    );

    const sup = await suppliersService.create(
      chemicalTenant.tenantId,
      {
        name: "Bengal Chemicals Supplier",
        phone: "+8801700998877",
      },
      chemicalTenant.ownerId,
    );
    supplierId = sup.id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await adminPrisma?.$disconnect();
  });

  // Test 1: A sale of 2.5 kg caustic soda: total ৳300, stock -2.5
  it("Test 1: sale of 2.5 kg caustic soda -> total ৳300, stock -2.5", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 30000, // 2.5 * 120 = ৳300
        items: [
          {
            variantId: csVariant.id,
            quantity: 2.5,
            unitPriceMinor: 12000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 30000,
          },
        ],
      });

    if (res.status !== 201) {
      console.error("Test 9 response error:", res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);
    expect(res.body.data.totalMinor).toBe(30000);

    const stock = await getStock(chemicalTenant.tenantId, csVariant.id, chemicalTenant.branchId);
    // 500 - 2.5 = 497.5
    expect(stock).toBe(497.5);
  });

  // Test 2: A sale of 1 drum HCl: price ৳8,500 (the override), stock -200
  it("Test 2: sale of 1 drum HCl -> price ৳8,500 (override), stock -200", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 850000, // ৳8,500
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            quantity: 1,
            unitPriceMinor: 850000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 850000,
          },
        ],
      });

    if (res.status !== 201) {
      console.error("Test 9 response error:", res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);
    expect(res.body.data.totalMinor).toBe(850000);
    expect(res.body.data.items[0].unitPriceMinor).toBe(850000);
    expect(Number(res.body.data.items[0].baseQuantity)).toBe(200);

    const stock = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);
    // 1000 - 200 = 800
    expect(stock).toBe(800);
  });

  // Test 3: A sale of 2 cans: price 2 × ৳225, stock -10
  it("Test 3: sale of 2 cans HCl -> price 2 × ৳225 = ৳450, stock -10", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 45000, // 2 * 22500 = ৳450
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: hclCanUnit.id,
            quantity: 2,
            unitPriceMinor: 22500,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 45000,
          },
        ],
      });

    if (res.status !== 201) {
      console.error("Test 9 response error:", res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);
    expect(res.body.data.totalMinor).toBe(45000);
    expect(Number(res.body.data.items[0].baseQuantity)).toBe(10);

    const stock = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);
    // 800 - 10 = 790
    expect(stock).toBe(790);
  });

  // Test 4: Decimal quantity on distilled water: 400
  it("Test 4: decimal quantity on distilled water (allowDecimalQty: false) -> 400", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 4500,
        items: [
          {
            variantId: dwVariant.id,
            quantity: 1.5, // Not allowed!
            unitPriceMinor: 3000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 4500,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code || res.body.message).toMatch(/DECIMAL_NOT_ALLOWED|allow/i);
  });

  // Test 5: A sale line with a unit of another product: 400
  it("Test 5: sale line with unit of another product -> 400", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 12000,
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: csBagUnit.id, // CS unit attached to HCl variant!
            quantity: 1,
            unitPriceMinor: 12000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 12000,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code || res.body.message).toMatch(/UNIT_NOT_FOUND|UNIT_PRODUCT_MISMATCH|not found/i);
  });

  // Test 6: Return 1 of 2 drums: restock +200, refund ৳8,500
  it("Test 6: return 1 of 2 drums -> restock +200, refund ৳8,500", async () => {
    // First, sell 2 drums
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        expectedTotalMinor: 1700000, // 2 * ৳8,500 = ৳17,000
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            quantity: 2,
            unitPriceMinor: 850000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 1700000,
          },
        ],
      });
    expect(saleRes.status).toBe(201);
    const saleItemId = saleRes.body.data.items[0].id;

    const stockBeforeReturn = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);

    // Return 1 drum
    const returnId = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/returns`)
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", returnId)
      .send({
        id: returnId,
        originalSaleId: saleId,
        shiftId: chemicalShiftId,
        branchId: chemicalTenant.branchId,
        reason: "Customer ordered 1 drum too many",
        refundMethod: "cash",
        items: [
          {
            saleItemId,
            quantity: 1, // 1 drum
            condition: "resellable",
          },
        ],
      });

    expect(retRes.status).toBe(201);
    expect(retRes.body.data.totalRefundMinor).toBe(850000); // ৳8,500

    const stockAfterReturn = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);
    // Stock increased by 200 base liters!
    expect(stockAfterReturn).toBe(stockBeforeReturn + 200);
  });

  // Test 7: Return after the drum factor was blocked from changing: restock still uses stored factor. Prove 409 on factor change.
  it("Test 7: factor modification blocked with 409 FACTOR_LOCKED once used; return uses stored factor", async () => {
    // Attempt to change drum factor from 200 to 250 -> 409 Conflict!
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/products/${hclProduct.id}/units/${hclDrumUnit.id}`)
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .send({
        name: "ড্রাম",
        factor: 250,
      });

    expect(patchRes.status).toBe(409);
    expect(["FACTOR_LOCKED", "UNIT_IN_USE"]).toContain(patchRes.body.error?.code);
  });

  // Test 8: Goods receipt of 2 drums at ৳8,000 each: stock +400, stock movement unit cost ৳40
  it("Test 8: goods receipt of 2 drums at ৳8,000 each -> stock +400, unitCostMinor = ৳40 (4000)", async () => {
    const stockBefore = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);

    // PO
    const po = await poService.create(
      chemicalTenant.tenantId,
      {
        supplierId,
        branchId: chemicalTenant.branchId,
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            qtyOrdered: 2,
            unitCostMinor: 800000, // ৳8,000 per drum
          },
        ],
      },
      chemicalTenant.ownerId,
    );
    await poService.updateStatus(chemicalTenant.tenantId, po.id, "ordered", chemicalTenant.ownerId);

    // Goods Receipt
    const gr = await grService.create(
      chemicalTenant.tenantId,
      {
        poId: po.id,
        supplierId,
        branchId: chemicalTenant.branchId,
        supplierInvoiceNo: "INV-CHEM-2026-001",
        items: [
          {
            poItemId: po.items[0].id,
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            qtyReceived: 2,
            unitCostMinor: 800000,
          },
        ],
      },
      chemicalTenant.ownerId,
    );

    expect(gr).toBeDefined();

    const stockAfter = await getStock(chemicalTenant.tenantId, hclVariant.id, chemicalTenant.branchId);
    // Stock increased by 2 * 200 = 400 base liters
    expect(stockAfter).toBe(stockBefore + 400);

    // Check stock movement unitCostMinor = 800000 / 200 = 4000 minor (৳40 per base liter)
    const movements = await adminPrisma.stockMovement.findMany({
      where: {
        tenantId: chemicalTenant.tenantId,
        variantId: hclVariant.id,
        refType: "goods_receipt",
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(movements.length).toBe(1);
    expect(Number(movements[0].unitCostMinor)).toBe(4000);
    expect(Number(movements[0].qtyDelta)).toBe(400);
  });

  // Test 9: An offline sale with a unit deactivated before sync: accepted, with a review flag
  it("Test 9: offline sale with deactivated unit -> accepted with review flag", async () => {
    // 1. Create a temporary unit on Distilled Water
    const tempUnit = await unitsService.createUnit(
      chemicalTenant.tenantId,
      dwProduct.id,
      {
        name: "মিনি প্যাক",
        factor: 2,
        isSaleUnit: true,
      },
      chemicalTenant.ownerId,
    );

    // 2. Prepare an offline sale payload using tempUnit
    const offlineSaleId = uuidv7();
    const offlinePayload = {
      id: offlineSaleId,
      shiftId: chemicalShiftId,
      branchId: chemicalTenant.branchId,
      isOffline: true,
      invoiceNumber: "REG01-O-261127-0001",
      occurredAt: new Date().toISOString(),
      expectedTotalMinor: 6000, // 2 * 3000
      items: [
        {
          variantId: dwVariant.id,
          productUnitId: tempUnit.id,
          unitName: tempUnit.name,
          unitFactor: 2,
          quantity: 1,
          unitPriceMinor: 6000,
        },
      ],
      payments: [
        {
          paymentMethod: "cash",
          amountMinor: 6000,
        },
      ],
    };

    // 3. Deactivate tempUnit before sync
    await unitsService.updateUnit(
      chemicalTenant.tenantId,
      dwProduct.id,
      tempUnit.id,
      { isActive: false },
      chemicalTenant.ownerId,
    );

    // 4. Sync offline sale
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${chemicalOwnerToken}`)
      .set("Idempotency-Key", offlineSaleId)
      .send(offlinePayload);

    if (res.status !== 201) {
      console.error("Test 9 response error:", res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);

    const flag = await adminPrisma.saleReviewFlag.findFirst({
      where: {
        saleId: offlineSaleId,
        flag: "UNIT_DEACTIVATED",
      },
    });
    expect(flag).toBeDefined();
    expect(flag?.flag).toBe("UNIT_DEACTIVATED");
  });

  // Test 10: The sale hash differs for the same variant in two units
  it("Test 10: sale hash differs for same variant in two different units", () => {
    const saleId = uuidv7();
    const branchId = chemicalTenant.branchId;
    const shiftId = chemicalShiftId;
    const payments = [{ paymentMethod: "cash" as const, amountMinor: 850000 }];

    // Item in base unit (1 liter)
    const hashBase = computeSalePayloadHash({
      id: saleId,
      branchId,
      shiftId,
      expectedTotalMinor: 4500,
      items: [
        {
          variantId: hclVariant.id,
          quantity: 1,
          unitPriceMinor: 4500,
        },
      ],
      payments,
    });

    // Item in drum unit (1 drum = 200 liters)
    const hashDrum = computeSalePayloadHash({
      id: saleId,
      branchId,
      shiftId,
      expectedTotalMinor: 850000,
      items: [
        {
          variantId: hclVariant.id,
          productUnitId: hclDrumUnit.id,
          quantity: 1,
          unitPriceMinor: 850000,
        },
      ],
      payments,
    });

    expect(hashBase).not.toBe(hashDrum);
  });

  // Test 11: Module off: product create with baseUnit: "kg" returns 403 MODULE_DISABLED; normal fashion sale works
  it("Test 11: module off: baseUnit != pcs returns 403 MODULE_DISABLED; fashion sale works as before", async () => {
    // In Fashion tenant (units disabled): create product with baseUnit "kg" -> 403 MODULE_DISABLED
    const resCreate = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${fashionOwnerToken}`)
      .send({
        name: "Invalid Grain Product",
        sku: "FASH-GRAIN",
        baseUnit: "kg",
        priceMinor: 5000,
      });

    expect(resCreate.status).toBe(403);
    expect(resCreate.body.error?.code).toBe("MODULE_DISABLED");

    // Normal fashion product creation (baseUnit: "pcs" or omitted) works
    const resNormal = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${fashionOwnerToken}`)
      .send({
        name: "Standard Polo T-Shirt",
        sku: "FASH-POLO-01",
        priceMinor: 150000,
      });

    expect(resNormal.status).toBe(201);
    expect(resNormal.body.data.baseUnit).toBe("pcs");
  });

  // Test 12: Migration backfill: old sale items have factor 1 and baseQuantity = quantity
  it("Test 12: migration backfill: all historical sale items have factor 1 and baseQuantity = quantity", async () => {
    const unbackfilledCount = await adminPrisma.$queryRaw<any[]>`
      SELECT id FROM sale_items WHERE unit_factor IS NULL OR base_quantity IS NULL;
    `;
    expect(unbackfilledCount.length).toBe(0);

    const backfilledItems = await adminPrisma.saleItem.findMany({
      where: {
        productUnitId: null,
        sale: { tenantId: fashionTenant.tenantId },
      },
      take: 10,
    });
    for (const it of backfilledItems) {
      expect(Number(it.unitFactor)).toBe(1);
      expect(Number(it.baseQuantity)).toBe(Number(it.quantity));
      expect(it.unitName).toBe("pcs");
    }
  });

  // Test 13: Promotion tests from Section 3
  it("Test 13: decimal quantity line does not break promotions; buy-2-get-1 counts cans, not liters", () => {
    // 13a: Decimal quantity line with percentage discount promotion
    const cartLines = [
      {
        lineId: "line-1",
        variantId: csVariant.id,
        productId: csProduct.id,
        quantity: "2.5",
        unitPriceMinor: 12000n, // ৳120 per kg
      },
    ];

    const percentagePromo: PromotionRule = {
      id: "promo-cs-10",
      name: "10% Off Caustic Soda",
      type: "PERCENT_OFF",
      status: "active",
      priority: 1,
      stackableWithBill: true,
      membersOnly: false,
      targetType: "ALL",
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() + 3600000),
      config: {
        percentBp: 1000, // 10.00%
      },
    };

    const evaluated = evaluatePromotions({
      lines: cartLines,
      promotions: [percentagePromo],
    });
    // 2.5 whole units = 2 whole units discounted at 10% (1,200 each = 2,400 minor). Line gross = 30,000 minor. Total = 27,600 minor.
    expect(evaluated.totalDiscountMinor).toBe(2400n);
    expect(evaluated.totalMinor).toBe(27600n);

    // 13b: Buy-2-get-1 on cans counts cans, not liters
    // 3 cans HCl bought (each 5 liters, factor 5). Total 3 cans.
    // Buy 2 get 1 free gives 1 CAN free (saving = ৳225 = 22500 minor), NOT counting 15 liters!
    const canCartLines = [
      {
        lineId: "line-can-1",
        variantId: hclVariant.id,
        productId: hclProduct.id,
        quantity: "3", // 3 cans
        unitPriceMinor: 22500n, // ৳225 per can
      },
    ];

    const b2g1Promo: PromotionRule = {
      id: "promo-b2g1-can",
      name: "Buy 2 Cans Get 1 Free",
      type: "BUY_X_GET_Y",
      status: "active",
      priority: 1,
      stackableWithBill: true,
      membersOnly: false,
      targetType: "ALL",
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() + 3600000),
      config: {
        buyQty: 2,
        getQty: 1,
        getDiscountPercentBp: 10000, // 100% free
      },
    };

    const b2g1Result = evaluatePromotions({
      lines: canCartLines,
      promotions: [b2g1Promo],
    });
    // 1 free can = 22,500 minor
    expect(b2g1Result.totalDiscountMinor).toBe(22500n);
    expect(b2g1Result.totalMinor).toBe(45000n); // 3 cans price (67,500) - 22,500 = 45,000 minor
  });
});
