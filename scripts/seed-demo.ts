import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../apps/api/dist/app.module.js";
import { TenantsService } from "../apps/api/dist/modules/tenants/tenants.service.js";
import { CatalogMetadataService } from "../apps/api/dist/modules/catalog/metadata.service.js";
import { ProductsService } from "../apps/api/dist/modules/catalog/products.service.js";
import { InventoryService } from "../apps/api/dist/modules/inventory/inventory.service.js";
import { SuppliersService } from "../apps/api/dist/modules/purchasing/suppliers.service.js";
import { PurchaseOrdersService } from "../apps/api/dist/modules/purchasing/purchase-orders.service.js";
import { GoodsReceiptsService } from "../apps/api/dist/modules/purchasing/goods-receipts.service.js";
import { CustomersService } from "../apps/api/dist/modules/shifts/customers.service.js";
import { RegistersService } from "../apps/api/dist/modules/shifts/registers.service.js";
import { ShiftsService } from "../apps/api/dist/modules/shifts/shifts.service.js";
import { SalesService } from "../apps/api/dist/modules/sales/sales.service.js";
import { UsersService } from "../apps/api/dist/modules/users/users.service.js";
import { RolesService } from "../apps/api/dist/modules/roles/roles.service.js";
import { v7 as uuidv7 } from "uuid";
import {
  DEMO_CATEGORIES,
  DEMO_BRANDS,
  DEMO_COLLECTIONS,
  DEMO_PRODUCTS,
  DEMO_SUPPLIERS,
  DEMO_CUSTOMERS,
} from "./demo-data.js";

function getTargetDbInfo() {
  const adminUrl =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public";
  const parsed = new URL(adminUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  return { adminUrl, dbName };
}

async function clearExistingTenant(adminUrl: string, dbName: string) {
  const isAllowedTestDb = dbName.endsWith("_e2e") || dbName.endsWith("_test");
  const hasYesFlag = process.argv.includes("--yes");

  if (!isAllowedTestDb && !hasYesFlag) {
    throw new Error(
      `[seed:demo] Refusing destructive tenant clear without explicit --yes flag on non-test database '${dbName}'. Pass --yes to confirm.`,
    );
  }

  const adminClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await adminClient.$executeRaw`DELETE FROM tenants WHERE slug = 'artisan-apparel';`;
  await adminClient.$disconnect();
}

async function seedTenantAndUsers(app: any) {
  const tenantsService = app.get(TenantsService);
  const usersService = app.get(UsersService);
  const rolesService = app.get(RolesService);

  const signup = await tenantsService.signup({
    companyName: "Artisan Apparel Ltd",
    slug: "artisan-apparel",
    businessType: "fashion",
    owner: { name: "Tariqul Islam", email: "owner@artisan.com", phone: "+8801700000010", password: "Password123!" },
    branch: { name: "Gulshan Flagship Store", code: "GFS-01", address: "Road 11, Block D, Banani / Gulshan, Dhaka" },
  });

  const roles = await rolesService.findMany(signup.tenantId);
  const cashierRole = roles.find((r: any) => r.name === "Cashier")!;
  const keeperRole = roles.find((r: any) => r.name === "Store Keeper")!;

  const cashier = await usersService.create(signup.tenantId, {
    name: "Sultana Razia", email: "cashier@artisan.com", phone: "+8801711223344", password: "Password123!",
    roleIds: [cashierRole.id], branchIds: [signup.branchId],
  });
  const keeper = await usersService.create(signup.tenantId, {
    name: "Babul Mia", email: "keeper@artisan.com", phone: "+8801722334455", password: "Password123!",
    roleIds: [keeperRole.id], branchIds: [signup.branchId],
  });

  return { tenantId: signup.tenantId, branchId: signup.branchId, ownerId: signup.ownerUserId, cashierId: cashier.id, keeperId: keeper.id };
}

async function seedCatalog(app: any, tId: string, bId: string, oId: string, kId: string) {
  const meta = app.get(CatalogMetadataService);
  const prods = app.get(ProductsService);
  const inv = app.get(InventoryService);

  const catMap = new Map<string, string>();
  for (const c of DEMO_CATEGORIES) {
    const parent = await meta.createCategory(tId, { name: c.name }, oId);
    catMap.set(c.name, parent.id);
    for (const sub of c.subcategories) {
      const subCat = await meta.createCategory(tId, { name: sub, parentId: parent.id }, oId);
      catMap.set(sub, subCat.id);
    }
  }

  const brandMap = new Map<string, string>();
  for (const b of DEMO_BRANDS) brandMap.set(b, (await meta.createBrand(tId, { name: b }, oId)).id);
  const colMap = new Map<string, string>();
  for (const c of DEMO_COLLECTIONS) colMap.set(c, (await meta.createCollection(tId, { name: c }, oId)).id);

  const variants: Array<{ id: string; priceMinor: number; costMinor: number }> = [];
  for (const p of DEMO_PRODUCTS) {
    const prod = await prods.create(tId, {
      name: p.name, sku: p.sku, categoryId: catMap.get(p.category),
      brandId: brandMap.get(p.brand), collectionId: colMap.get(p.collection),
      priceMinor: p.priceMinor, costMinor: p.costMinor, options: p.options,
    }, oId);
    for (const v of prod.variants) variants.push({ id: v.id, priceMinor: p.priceMinor, costMinor: p.costMinor });
  }

  await inv.createOpeningStock(tId, {
    branchId: bId,
    items: variants.map((v) => ({ variantId: v.id, quantity: 30, unitCostMinor: v.costMinor })),
  }, kId);
  return variants;
}

async function seedPurchasing(app: any, tId: string, bId: string, kId: string, vars: any[]) {
  const sups = app.get(SuppliersService);
  const pos = app.get(PurchaseOrdersService);
  const grs = app.get(GoodsReceiptsService);

  const supIds: string[] = [];
  for (const s of DEMO_SUPPLIERS) supIds.push((await sups.create(tId, s, kId)).id);

  const po = await pos.create(tId, {
    supplierId: supIds[0], branchId: bId,
    items: [
      { variantId: vars[0].id, qtyOrdered: 20, unitCostMinor: vars[0].costMinor },
      { variantId: vars[1].id, qtyOrdered: 20, unitCostMinor: vars[1].costMinor },
    ],
  }, kId);
  await pos.updateStatus(tId, po.id, "ordered", kId);

  await grs.create(tId, {
    poId: po.id, supplierId: supIds[0], branchId: bId, supplierInvoiceNo: "INV-TEX-2026-091",
    items: [
      { poItemId: po.items[0].id, variantId: vars[0].id, qtyReceived: 20, unitCostMinor: vars[0].costMinor },
      { poItemId: po.items[1].id, variantId: vars[1].id, qtyReceived: 20, unitCostMinor: vars[1].costMinor },
    ],
  }, kId);
}

async function seedCustomersAndRegisters(app: any, tId: string, bId: string, oId: string) {
  const custs = app.get(CustomersService);
  const regs = app.get(RegistersService);
  const customerIds: string[] = [];
  for (const c of DEMO_CUSTOMERS) customerIds.push((await custs.create(tId, c, oId)).id);
  const reg1 = await regs.create(tId, { branchId: bId, name: "Main Counter", code: "REG01" }, oId);
  await regs.create(tId, { branchId: bId, name: "Express Counter", code: "REG02" }, oId);
  return { customerIds, reg1Id: reg1.id };
}

async function seedShiftsAndSales(app: any, tId: string, bId: string, oId: string, cId: string, vars: any[], custIds: string[], regId: string) {
  const shifts = app.get(ShiftsService);
  const sales = app.get(SalesService);

  // Shift 1 (Closed)
  const s1 = await shifts.open(tId, { registerId: regId, branchId: bId, openingCashMinor: 50000, notes: "Morning" }, cId);
  await shifts.addCashMovement(tId, s1.id, { type: "cash_in", amountMinor: 10000, reason: "Float addition" }, cId);
  for (let i = 0; i < 3; i++) {
    await sales.create(tId, {
      id: uuidv7(),
      shiftId: s1.id, branchId: bId, customerId: custIds[i], pricesIncludeTax: true,
      expectedTotalMinor: vars[i].priceMinor,
      items: [{ variantId: vars[i].id, quantity: 1, unitPriceMinor: vars[i].priceMinor, taxRateBp: 500 }],
      payments: [{ paymentMethod: i % 2 === 0 ? "cash" : "bkash", amountMinor: vars[i].priceMinor }],
    }, cId);
  }
  await shifts.close(tId, s1.id, { closingCashMinor: 60000, notes: "Morning closed" }, cId);

  // Shift 2 (Open)
  const s2 = await shifts.open(tId, { registerId: regId, branchId: bId, openingCashMinor: 50000, notes: "Afternoon" }, cId);
  await shifts.addCashMovement(tId, s2.id, { type: "cash_out", amountMinor: 2000, reason: "Store refreshments" }, cId);
  for (let i = 3; i < 10; i++) {
    const sale = await sales.create(tId, {
      id: uuidv7(),
      shiftId: s2.id, branchId: bId, customerId: custIds[i % custIds.length], pricesIncludeTax: true,
      expectedTotalMinor: vars[i].priceMinor * 2,
      items: [{ variantId: vars[i].id, quantity: 2, unitPriceMinor: vars[i].priceMinor, taxRateBp: 500 }],
      payments: [{ paymentMethod: i % 3 === 0 ? "cash" : i % 3 === 1 ? "bkash" : "card", amountMinor: vars[i].priceMinor * 2 }],
    }, cId);
    if (i === 9) await sales.voidSale(tId, sale.id, { reason: "Customer card declined after processing" }, oId);
  }
}

async function runSeeder() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data in production environment (NODE_ENV=production)");
  }

  const { adminUrl, dbName } = getTargetDbInfo();
  // Ensure AppModule / PrismaService connects to the target database
  process.env.DATABASE_URL = adminUrl;
  if (process.env.TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = adminUrl;
  }
  const isAllowedTestDb = dbName.endsWith("_e2e") || dbName.endsWith("_test");
  const hasYesFlag = process.argv.includes("--yes");

  if (!isAllowedTestDb && !hasYesFlag) {
    throw new Error(
      `[seed:demo] Refusing destructive tenant clear without explicit --yes flag on non-test database '${dbName}'. Pass --yes to confirm.`,
    );
  }

  // Check if simulated boot failure is requested by tests
  if (process.env.FAIL_SEED_BOOT === "true") {
    throw new Error("[seed:demo] Simulated application boot failure before tenant clearing");
  }

  // 1. Boot Nest app context and verify it works BEFORE deleting anything!
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    // 2. Clear existing tenant ONLY after app context is booted and ready
    await clearExistingTenant(adminUrl, dbName);

    // 3. Seed tenant and dependencies
    const { tenantId, branchId, ownerId, cashierId, keeperId } = await seedTenantAndUsers(app);
    const variants = await seedCatalog(app, tenantId, branchId, ownerId, keeperId);
    await seedPurchasing(app, tenantId, branchId, keeperId, variants);
    const { customerIds, reg1Id } = await seedCustomersAndRegisters(app, tenantId, branchId, ownerId);
    await seedShiftsAndSales(app, tenantId, branchId, ownerId, cashierId, variants, customerIds, reg1Id);
    return { tenantId, branchId, ownerEmail: "owner@artisan.com" };
  } finally {
    await app.close();
  }
}

runSeeder()
  .then((res) => {
    process.stdout.write(`Demo data successfully seeded for tenant ${res.tenantId} (${res.ownerEmail})\n`);
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`Seeding failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  });
