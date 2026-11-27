import { PrismaClient } from "@prisma/client";

async function main() {
  const url =
    process.argv[2] ||
    process.env.MIGRATION_DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public";
  const p = new PrismaClient({ datasources: { db: { url } } });

  const saleItems = await p.saleItem.count();
  const poItems = await p.purchaseOrderItem.count();
  const grItems = await p.goodsReceiptItem.count();
  const returnItems = await p.saleReturnItem.count();

  console.log("MIGRATION COUNTS (url=" + url.split("/").pop() + "):");
  console.log(JSON.stringify({
    saleItems,
    poItems,
    grItems,
    returnItems,
  }, null, 2));

  // Check if columns exist (post-migration)
  try {
    const rawCounts: any[] = await p.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM sale_items WHERE unit_factor = 1) AS sale_items_factor_1,
        (SELECT count(*) FROM purchase_order_items WHERE unit_factor = 1) AS po_items_factor_1,
        (SELECT count(*) FROM goods_receipt_items WHERE unit_factor = 1) AS gr_items_factor_1,
        (SELECT count(*) FROM sale_items WHERE base_quantity IS NOT NULL) AS sale_items_base_qty,
        (SELECT count(*) FROM purchase_order_items WHERE base_quantity IS NOT NULL) AS po_items_base_qty,
        (SELECT count(*) FROM goods_receipt_items WHERE base_qty_received IS NOT NULL) AS gr_items_base_qty,
        (SELECT count(*) FROM sale_return_items WHERE base_quantity IS NOT NULL) AS return_items_base_qty
    `);
    console.log("MIGRATION FACTOR 1 & BASE QTY COUNTS:", rawCounts[0]);
  } catch (err: any) {
    console.log("Columns not yet created (pre-migration).");
  }

  await p.$disconnect();
}

main().catch(console.error);
