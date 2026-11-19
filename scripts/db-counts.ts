import { PrismaClient } from "@prisma/client";

async function main() {
  const url =
    process.argv[2] ||
    process.env.MIGRATION_DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public";
  const p = new PrismaClient({ datasources: { db: { url } } });
  const counts = {
    products: await p.product.count(),
    variants: await p.productVariant.count(),
    stockLevels: await p.stockLevel.count(),
    customers: await p.customer.count(),
    sales: await p.sale.count(),
    shifts: await p.shift.count(),
    registers: await p.register.count(),
    suppliers: await p.supplier.count(),
    purchaseOrders: await p.purchaseOrder.count(),
    goodsReceipts: await p.goodsReceipt.count(),
  };
  console.log(`[DB COUNTS for ${url.split("/").pop()}]:`, JSON.stringify(counts, null, 2));
  await p.$disconnect();
}

main().catch(console.error);
